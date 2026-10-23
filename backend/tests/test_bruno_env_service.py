import subprocess
from pathlib import Path

import pytest

from app.services import bruno_env_service as svc
from app.services.properties_service import PropertiesError

ENV = """vars {
  baseUrl: https://test.example.com
  ~oldUrl: https://old.example.com
  client_secret: s3cr3t
  notes: '''
    line one
    line two
  '''
}
vars:secret [
  apiKey,
  ~legacyToken
]
"""


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    collection = tmp_path / "suite" / "payments"
    (collection / "environments").mkdir(parents=True)
    (collection / "bruno.json").write_text("{}")
    (collection / "environments" / "Test.bru").write_text(ENV)
    (tmp_path / "suite" / "environments").mkdir()
    (tmp_path / "suite" / "environments" / "Shared.bru").write_text("vars {\n  host: a\n}\n")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    git = ["git", "-c", "user.email=t@e", "-c", "user.name=t"]
    subprocess.run([*git, "add", "."], cwd=tmp_path, check=True)
    subprocess.run([*git, "commit", "-qm", "init"], cwd=tmp_path, check=True)
    return tmp_path


def _entries(view):
    return {e["id"]: e for e in view["entries"]}


def test_parse_reads_vars_disabled_multiline_and_secret_list():
    parsed = svc.parse(ENV)
    names = [(v.name, v.enabled, v.secret_list, v.multiline) for v in parsed.variables]
    assert names == [
        ("baseUrl", True, False, False),
        ("oldUrl", False, False, False),
        ("client_secret", True, False, False),
        ("notes", True, False, True),
        ("apiKey", True, True, False),
        ("legacyToken", False, True, False),
    ]
    assert parsed.vars_block == (0, 8)


def test_list_files_includes_collection_and_parent_environments(repo):
    files = svc.list_files(repo, "suite/payments")
    assert [(f["path"], f["shared"]) for f in files] == [
        ("suite/payments/environments/Test.bru", False),
        ("suite/environments/Shared.bru", True),
    ]


def test_read_masks_secrets_and_marks_readonly(repo):
    view = svc.read_file(repo, "suite/payments/environments/Test.bru")
    entries = _entries(view)
    assert entries["baseUrl"]["value"] == "https://test.example.com"
    assert entries["client_secret"]["value"] is None and entries["client_secret"]["secret"]
    assert entries["secret:apiKey"]["readonly"] and entries["notes"]["readonly"]
    assert entries["oldUrl"]["enabled"] is False
    revealed = _entries(svc.read_file(repo, "suite/payments/environments/Test.bru", reveal=True))
    assert revealed["client_secret"]["value"] == "s3cr3t"


def test_update_changes_toggles_and_adds_preserving_rest(repo):
    rel = "suite/payments/environments/Test.bru"
    view = svc.read_file(repo, rel)
    updated = svc.update_file(repo, rel, view["etag"],
                              {"baseUrl": "https://new.example.com"}, {"timeout": "30"},
                              {"oldUrl": True, "baseUrl": False})
    text = (repo / rel).read_text()
    assert "  ~baseUrl: https://new.example.com\n" in text
    assert "  oldUrl: https://old.example.com\n" in text
    assert "  timeout: 30\n}\nvars:secret [" in text
    assert "    line one\n" in text and "  apiKey,\n" in text
    assert updated["git_status"] == "modified"


def test_update_rejects_stale_etag_newlines_and_bad_names(repo):
    rel = "suite/payments/environments/Test.bru"
    etag = svc.read_file(repo, rel)["etag"]
    with pytest.raises(PropertiesError) as stale:
        svc.update_file(repo, rel, "stale", {"baseUrl": "x"}, {})
    assert stale.value.status_code == 409
    with pytest.raises(PropertiesError, match="single line"):
        svc.update_file(repo, rel, etag, {"baseUrl": "a\nb"}, {})
    with pytest.raises(PropertiesError, match="Invalid variable name"):
        svc.update_file(repo, rel, etag, {}, {"bad name": "x"})
    with pytest.raises(PropertiesError, match="multi-line"):
        svc.update_file(repo, rel, etag, {"notes": "x"}, {})


def test_paths_outside_environments_are_rejected(repo):
    with pytest.raises(PropertiesError):
        svc.read_file(repo, "suite/payments/bruno.json")
    with pytest.raises(PropertiesError):
        svc.read_file(repo, "../etc/environments/x.bru")
    with pytest.raises(PropertiesError):
        svc.list_files(repo, "../outside")


def test_revert_restores_committed_version(repo):
    rel = "suite/payments/environments/Test.bru"
    view = svc.read_file(repo, rel)
    svc.update_file(repo, rel, view["etag"], {"baseUrl": "changed"}, {})
    reverted = svc.revert_file(repo, rel)
    assert reverted["git_status"] == "clean"
    assert (repo / rel).read_text() == ENV
