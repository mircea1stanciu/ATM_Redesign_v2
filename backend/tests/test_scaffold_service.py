import asyncio
import json
import subprocess
from pathlib import Path

import pytest

from app.services import scaffold_service as svc


def test_catalog_matches_templates_and_upskilling_languages():
    catalog = svc.catalog()
    ids = [f["id"] for f in catalog["frameworks"]]
    assert ids == [f["id"] for f in svc.FRAMEWORKS]
    pairs = {(f["id"], o["language"]) for f in catalog["frameworks"] for o in f["languages"]}
    assert pairs == set(svc.TEMPLATES)
    assert set(catalog["languages"]) == {"javascript", "java", "python"}
    for framework, language in svc.TEMPLATES:
        assert (svc.SCAFFOLD_ROOT / f"{framework}-{language}").is_dir()


def test_every_template_has_a_gitignore_and_build_manifest():
    for framework, language in svc.TEMPLATES:
        root = svc.SCAFFOLD_ROOT / f"{framework}-{language}"
        assert (root / ".gitignore").is_file(), root
        manifest = {"java": "pom.xml", "python": "requirements.txt", "javascript": "package.json"}[language]
        assert (root / manifest).is_file(), root
        if manifest == "package.json":
            json.loads((root / manifest).read_text())


def test_create_project_writes_files_readme_and_initial_commit(tmp_path):
    target = svc.create_project(tmp_path / "new" / "folder", "junit5", "java", "Payments API!", "Jane", "jane@x.io")
    assert target == tmp_path / "new" / "folder"
    pom = (target / "pom.xml").read_text()
    assert "<artifactId>payments-api</artifactId>" in pom and "<name>Payments API!</name>" in pom
    assert "__PROJECT_" not in pom
    readme = (target / "README.md").read_text()
    assert readme.startswith("# Payments API!") and "mvn test" in readme
    log = subprocess.run(["git", "log", "--format=%an|%s", "-1"], cwd=target, capture_output=True, text=True).stdout
    assert "JUnit 5 (Java) starter" in log
    branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=target, capture_output=True,
                            text=True).stdout.strip()
    assert branch == "main"
    status = subprocess.run(["git", "status", "--porcelain"], cwd=target, capture_output=True, text=True).stdout
    assert status == ""


def test_bruno_placeholders_do_not_clash_with_bruno_variables(tmp_path):
    target = svc.create_project(tmp_path / "b", "bruno", "javascript", "Demo", "a", "a@b.c")
    request = (target / "collections/sample-api/posts/Get post.bru").read_text()
    assert "{{baseUrl}}/posts/{{postId}}" in request


def test_non_empty_folder_uses_project_subfolder(tmp_path):
    (tmp_path / "notes.txt").write_text("x")
    assert svc.resolve_target(tmp_path, "My Project") == tmp_path / "my-project"
    (tmp_path / "my-project").mkdir()
    (tmp_path / "my-project" / "a").write_text("x")
    with pytest.raises(svc.ScaffoldError):
        svc.resolve_target(tmp_path, "My Project")


def test_unknown_combination_is_rejected(tmp_path):
    with pytest.raises(svc.ScaffoldError, match="No starter template"):
        svc.create_project(tmp_path / "x", "cypress", "java", "x")


def _run_job(monkeypatch, tmp_path, steps):
    template = svc.Template("fake", "python", ("python",), ("run",), steps, "nothing")
    monkeypatch.setitem(svc.TEMPLATES, ("fake", "python"), template)

    async def scenario():
        job = svc.start_verify(4242, tmp_path, "fake", "python")
        while job.status == "running":
            await asyncio.sleep(0.05)
        return job

    return asyncio.run(scenario())


def test_verify_job_runs_steps_and_streams_output(monkeypatch, tmp_path):
    job = _run_job(monkeypatch, tmp_path, (
        ("Say hello", ("{python}", "-c", "print('hello from step')")),
        ("Check env", ("{python}", "-c", "import os; assert os.environ['CI'] == '1'")),
    ))
    assert job.status == "passed"
    assert [s["status"] for s in job.steps] == ["passed", "passed"]
    assert "hello from step" in job.log
    assert job.to_dict(since=1)["log"] == job.log[1:]


def test_verify_job_stops_at_first_failing_step(monkeypatch, tmp_path):
    job = _run_job(monkeypatch, tmp_path, (
        ("Fail", ("{python}", "-c", "import sys; sys.exit(3)")),
        ("Never runs", ("{python}", "-c", "print(1)")),
    ))
    assert job.status == "failed"
    assert [s["status"] for s in job.steps] == ["failed", "pending"]
    assert any("exit code 3" in line for line in job.log)


def test_job_environment_points_tools_at_station_ca_bundle(monkeypatch):
    for name in ("NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE", "SSL_CERT_FILE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(svc, "station_ca_bundle", lambda: "/tmp/bundle.pem")
    env = svc.job_environment()
    assert env["NODE_EXTRA_CA_CERTS"] == env["REQUESTS_CA_BUNDLE"] == "/tmp/bundle.pem"
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", "/custom.pem")
    assert svc.job_environment()["NODE_EXTRA_CA_CERTS"] == "/custom.pem"


def test_starter_files_have_no_leftover_placeholders(tmp_path):
    for framework, language in svc.TEMPLATES:
        target = svc.create_project(tmp_path / f"{framework}-{language}", framework, language, "Demo", "a", "a@b.c")
        for file in Path(target).rglob("*"):
            if file.is_file() and ".git" not in file.parts:
                assert "__PROJECT_" not in file.read_text(), file


def test_delete_project_removes_local_only_starter(tmp_path):
    target = svc.create_project(tmp_path / "starter", "junit5", "java", "Demo", "a", "a@b.c")
    assert svc.git_remotes(target) == []
    svc.delete_project(target)
    assert not target.exists()
    svc.delete_project(target)  # already gone: no error


def test_delete_project_refuses_when_connected_to_a_remote(tmp_path):
    target = svc.create_project(tmp_path / "starter", "junit5", "java", "Demo", "a", "a@b.c")
    subprocess.run(["git", "remote", "add", "origin", "https://github.com/acme/demo.git"], cwd=target, check=True)
    assert svc.git_remotes(target) == ["origin"]
    with pytest.raises(svc.ScaffoldError, match="remote repository"):
        svc.delete_project(target)
    assert target.exists()


def test_delete_project_refuses_dangerous_or_foreign_folders(tmp_path):
    with pytest.raises(svc.ScaffoldError, match="Refusing"):
        svc.delete_project(Path.home())
    (tmp_path / "plain").mkdir()
    with pytest.raises(svc.ScaffoldError, match="not the generated git repository"):
        svc.delete_project(tmp_path / "plain")
