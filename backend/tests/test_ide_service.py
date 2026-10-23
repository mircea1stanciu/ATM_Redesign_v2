import plistlib
import sys
from pathlib import Path

import pytest

from app.services import ide_service


def _fake_app(folder: Path, name: str, version: str) -> Path:
    app = folder / name
    (app / "Contents").mkdir(parents=True)
    with open(app / "Contents" / "Info.plist", "wb") as handle:
        plistlib.dump({"CFBundleShortVersionString": version}, handle)
    return app


@pytest.fixture()
def fake_mac(tmp_path, monkeypatch):
    applications = tmp_path / "Applications"
    home = tmp_path / "home"
    (home / "Applications").mkdir(parents=True)
    applications.mkdir()
    monkeypatch.setattr(ide_service.sys, "platform", "darwin")
    monkeypatch.setattr(ide_service.Path, "home", classmethod(lambda cls: home))
    original_glob = ide_service.glob.glob

    def redirected(pattern, *args, **kwargs):
        return original_glob(pattern.replace("/Applications", str(applications), 1)
                             if pattern.startswith("/Applications") else pattern, *args, **kwargs)

    monkeypatch.setattr(ide_service.glob, "glob", redirected)
    monkeypatch.setattr(ide_service, "_cache", None)
    return applications, home


def test_detects_only_installed_ides_and_prefers_newest_copy(fake_mac):
    applications, home = fake_mac
    _fake_app(applications, "Visual Studio Code.app", "1.90.0")
    _fake_app(applications, "IntelliJ IDEA.app", "2024.1")
    toolbox = _fake_app(home / "Applications", "IntelliJ IDEA.app", "2025.3")
    (applications / "Broken.app").mkdir()
    ides = {ide.id: ide for ide in ide_service.detect_ides(refresh=True)}
    assert set(ides) == {"vscode", "intellij"}
    assert ides["intellij"].executable == str(toolbox) and ides["intellij"].version == "2025.3"
    assert ides["vscode"].public() == {"id": "vscode", "name": "Visual Studio Code", "version": "1.90.0",
                                       "kind": "editor", "notes": ""}


def test_open_uses_detected_app_and_rejects_unknown_ids(fake_mac, tmp_path, monkeypatch):
    applications, _ = fake_mac
    app = _fake_app(applications, "Visual Studio Code.app", "1.90.0")
    calls = []

    class FakeProcess:
        def __init__(self, argv, **kwargs):
            calls.append((argv, kwargs))

        def wait(self, timeout=None):
            return 0

    monkeypatch.setattr(ide_service.subprocess, "Popen", FakeProcess)
    project = tmp_path / "project"
    project.mkdir()
    ide_service.detect_ides(refresh=True)
    assert ide_service.open_in_ide("vscode", project).name == "Visual Studio Code"
    assert calls[0][0] == ["open", "-a", str(app), str(project)]
    with pytest.raises(ide_service.IDEError, match="not installed"):
        ide_service.open_in_ide("eclipse", project)
    with pytest.raises(ide_service.IDEError, match="does not exist"):
        ide_service.open_in_ide("vscode", project / "missing")


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX paths")
def test_linux_detection_uses_path_and_install_globs(tmp_path, monkeypatch):
    monkeypatch.setattr(ide_service.sys, "platform", "linux")
    monkeypatch.setattr(ide_service.os, "name", "posix")
    monkeypatch.setattr(ide_service, "_cache", None)
    monkeypatch.setattr(ide_service.shutil, "which", lambda cmd: "/usr/bin/code" if cmd == "code" else None)
    eclipse = tmp_path / "eclipse" / "java-2025-09" / "eclipse" / "eclipse"
    eclipse.parent.mkdir(parents=True)
    eclipse.write_text("#!/bin/sh\n")
    eclipse.chmod(0o755)
    monkeypatch.setenv("HOME", str(tmp_path))
    ides = {ide.id: ide.executable for ide in ide_service.detect_ides(refresh=True)}
    assert ides["vscode"] == "/usr/bin/code"
    assert ides["eclipse"] == str(eclipse)
