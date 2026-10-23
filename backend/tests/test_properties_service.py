import subprocess

import pytest

from app.services import properties_service as props
from app.services.properties_service import PropertiesError

ENV_PROPS = (
    "# --------------------- Driver config ----\n"
    "appEnv = pre\n"
    "! old style comment\n"
    "deviceRunOption=i15\n"
    "reportReleaseTag =\n"
    "longValue = first \\\n"
    "    second\n"
    "loginPassword = s3cr3t\n"
    "path\\:with\\=escapes : a\\\\b\n"
)


@pytest.fixture
def repo(tmp_path):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=tmp_path, check=True)
    resources = tmp_path / "src/test/resources"
    (resources / "userProps").mkdir(parents=True)
    (resources / "envProp.properties").write_bytes(ENV_PROPS.encode("latin-1"))
    (resources / "userProps/userProp.properties").write_text("loginPassword = x\n")
    (tmp_path / "target/classes").mkdir(parents=True)
    (tmp_path / "target/classes/envProp.properties").write_text("copied = true\n")
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-qm", "init"], cwd=tmp_path, check=True)
    return tmp_path


def _entries(view):
    return {e["key"]: e for e in view["entries"]}


def test_discovery_skips_build_output(repo):
    files = [f["path"] for f in props.list_files(repo)]
    assert files == ["src/test/resources/envProp.properties", "src/test/resources/userProps/userProp.properties"]


def test_read_parses_values_and_masks_secrets(repo):
    view = props.read_file(repo, "src/test/resources/envProp.properties")
    entries = _entries(view)

    assert entries["appEnv"]["value"] == "pre"
    assert entries["deviceRunOption"]["value"] == "i15"
    assert entries["reportReleaseTag"]["value"] == ""
    assert entries["longValue"]["value"] == "first second"
    assert entries["longValue"]["multiline"] is True
    assert entries["path:with=escapes"]["value"] == "a\\b"
    assert entries["loginPassword"] == {**entries["loginPassword"], "value": None, "secret": True, "has_value": True}
    assert view["git_status"] == "clean"

    revealed = _entries(props.read_file(repo, "src/test/resources/envProp.properties", reveal=True))
    assert revealed["loginPassword"]["value"] == "s3cr3t"


def test_update_preserves_comments_and_untouched_lines(repo):
    path = "src/test/resources/envProp.properties"
    view = props.read_file(repo, path)

    updated = props.update_file(repo, path, view["etag"],
                                {"deviceRunOption": "i20", "longValue": "single line", "appEnv": "test"},
                                {"newFlag": "ăbc"})

    text = (repo / path).read_bytes().decode("latin-1")
    assert text == (
        "# --------------------- Driver config ----\n"
        "appEnv = test\n"
        "! old style comment\n"
        "deviceRunOption=i20\n"
        "reportReleaseTag =\n"
        "longValue = single line\n"
        "loginPassword = s3cr3t\n"
        "path\\:with\\=escapes : a\\\\b\n"
        "newFlag = \\u0103bc\n"
    )
    assert _entries(updated)["newFlag"]["value"] == "ăbc"
    assert updated["git_status"] == "modified"


def test_update_rejects_stale_etag(repo):
    path = "src/test/resources/envProp.properties"
    view = props.read_file(repo, path)
    (repo / path).write_text(ENV_PROPS + "edited = elsewhere\n")
    with pytest.raises(PropertiesError) as exc:
        props.update_file(repo, path, view["etag"], {"appEnv": "test"}, {})
    assert exc.value.status_code == 409


@pytest.mark.parametrize(
    "changes,additions,message",
    [
        ({"missing": "x"}, {}, "does not exist"),
        ({}, {"appEnv": "x"}, "already exists"),
        ({}, {"bad key": "x"}, "Invalid property name"),
        ({}, {"x\nmalicious": "y"}, "Invalid property name"),
    ],
)
def test_update_validation(repo, changes, additions, message):
    path = "src/test/resources/envProp.properties"
    view = props.read_file(repo, path)
    with pytest.raises(PropertiesError, match=message):
        props.update_file(repo, path, view["etag"], changes, additions)


def test_newlines_in_values_are_escaped(repo):
    path = "src/test/resources/envProp.properties"
    view = props.read_file(repo, path)
    props.update_file(repo, path, view["etag"], {"appEnv": "pre\ninjected = 1"}, {})
    entries = _entries(props.read_file(repo, path))
    assert entries["appEnv"]["value"] == "pre\ninjected = 1"
    assert "injected" not in entries


@pytest.mark.parametrize(
    "rel_path",
    ["../outside.properties", "/etc/hosts", "target/classes/envProp.properties", "pom.xml", ""],
)
def test_paths_outside_detected_files_are_rejected(repo, rel_path):
    (repo.parent / "outside.properties").write_text("a=b\n")
    with pytest.raises(PropertiesError):
        props.read_file(repo, rel_path)


def test_revert_restores_committed_version(repo):
    path = "src/test/resources/envProp.properties"
    view = props.read_file(repo, path)
    props.update_file(repo, path, view["etag"], {"appEnv": "test"}, {})

    reverted = props.revert_file(repo, path)

    assert _entries(reverted)["appEnv"]["value"] == "pre"
    assert reverted["git_status"] == "clean"
    with pytest.raises(PropertiesError, match="Only files with local changes"):
        props.revert_file(repo, path)
