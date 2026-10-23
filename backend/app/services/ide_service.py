"""Detect IDEs installed on this station and open a project folder or file in one of them.

Supports macOS (.app bundles in /Applications and ~/Applications, incl. JetBrains Toolbox), Windows
(standard install folders) and Linux (commands on PATH and common install folders). Only IDEs that
are actually found are offered; callers pass an IDE id from :func:`detect_ides`, never a command.
"""
from __future__ import annotations

import glob
import os
import plistlib
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_CACHE_SECONDS = 60
_cache: tuple[float, list[IDE]] | None = None


@dataclass
class IDE:
    id: str
    name: str
    version: str | None
    executable: str  # .app bundle on macOS, executable elsewhere
    kind: str = "ide"  # "ide" | "editor"
    notes: str = ""
    extra_args: list[str] = field(default_factory=list)

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "version": self.version, "kind": self.kind, "notes": self.notes}


# id, display name, kind, macOS bundle globs, Windows exe globs, Linux commands / globs
_CANDIDATES: list[dict] = [
    {"id": "vscode", "name": "Visual Studio Code", "kind": "editor",
     "mac": ["Visual Studio Code.app"],
     "win": [r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe", r"%ProgramFiles%\Microsoft VS Code\Code.exe"],
     "linux": ["code", "/usr/share/code/code", "/snap/bin/code"]},
    {"id": "cursor", "name": "Cursor", "kind": "editor",
     "mac": ["Cursor.app"], "win": [r"%LOCALAPPDATA%\Programs\cursor\Cursor.exe"], "linux": ["cursor"]},
    {"id": "intellij", "name": "IntelliJ IDEA", "kind": "ide",
     "mac": ["IntelliJ IDEA.app", "IntelliJ IDEA Ultimate.app"],
     "win": [r"%ProgramFiles%\JetBrains\IntelliJ IDEA 2*\bin\idea64.exe",
             r"%LOCALAPPDATA%\Programs\IntelliJ IDEA Ultimate\bin\idea64.exe",
             r"%LOCALAPPDATA%\JetBrains\Toolbox\apps\IDEA-U\*\*\bin\idea64.exe"],
     "linux": ["idea", "intellij-idea-ultimate", "/opt/idea-IU*/bin/idea.sh", "/snap/bin/intellij-idea-ultimate"]},
    {"id": "intellij-ce", "name": "IntelliJ IDEA Community", "kind": "ide",
     "mac": ["IntelliJ IDEA CE.app", "IntelliJ IDEA Community Edition.app"],
     "win": [r"%ProgramFiles%\JetBrains\IntelliJ IDEA Community Edition*\bin\idea64.exe",
             r"%LOCALAPPDATA%\Programs\IntelliJ IDEA Community Edition\bin\idea64.exe"],
     "linux": ["intellij-idea-community", "/opt/idea-IC*/bin/idea.sh", "/snap/bin/intellij-idea-community"]},
    {"id": "webstorm", "name": "WebStorm", "kind": "ide",
     "mac": ["WebStorm.app"], "win": [r"%ProgramFiles%\JetBrains\WebStorm*\bin\webstorm64.exe"],
     "linux": ["webstorm", "/snap/bin/webstorm"]},
    {"id": "pycharm", "name": "PyCharm", "kind": "ide",
     "mac": ["PyCharm.app", "PyCharm CE.app", "PyCharm Professional Edition.app"],
     "win": [r"%ProgramFiles%\JetBrains\PyCharm*\bin\pycharm64.exe"],
     "linux": ["pycharm", "pycharm-community", "/snap/bin/pycharm-community", "/snap/bin/pycharm-professional"]},
    {"id": "eclipse", "name": "Eclipse", "kind": "ide",
     "notes": "Eclipse offers to import the folder (File › Import › Existing Maven/Gradle project) if needed.",
     "mac": ["Eclipse.app", "Eclipse*.app", "~/eclipse/*/Eclipse.app"],
     "win": [r"C:\eclipse\eclipse.exe", r"%ProgramFiles%\eclipse\eclipse.exe",
             r"%USERPROFILE%\eclipse\*\eclipse\eclipse.exe"],
     "linux": ["eclipse", "~/eclipse/*/eclipse/eclipse", "/opt/eclipse/eclipse", "/snap/bin/eclipse"]},
    {"id": "android-studio", "name": "Android Studio", "kind": "ide",
     "mac": ["Android Studio.app"], "win": [r"%ProgramFiles%\Android\Android Studio\bin\studio64.exe"],
     "linux": ["studio.sh", "/opt/android-studio/bin/studio.sh", "/snap/bin/android-studio"]},
    {"id": "sublime", "name": "Sublime Text", "kind": "editor",
     "mac": ["Sublime Text.app"], "win": [r"%ProgramFiles%\Sublime Text\sublime_text.exe"], "linux": ["subl"]},
]


def _mac_version(app: Path) -> str | None:
    try:
        with open(app / "Contents" / "Info.plist", "rb") as handle:
            info = plistlib.load(handle)
    except (OSError, plistlib.InvalidFileException, ValueError):
        return None
    return info.get("CFBundleShortVersionString") or info.get("CFBundleVersion")


def _version_key(version: str | None) -> tuple:
    return tuple(int(n) for n in re.findall(r"\d+", version or "")[:4])


def _detect_mac(candidate: dict) -> IDE | None:
    folders = [Path("/Applications"), Path.home() / "Applications", Path.home() / "Applications" / "JetBrains Toolbox"]
    found: list[Path] = []
    for pattern in candidate["mac"]:
        if pattern.startswith("~"):
            found += [Path(p) for p in glob.glob(os.path.expanduser(pattern))]
            continue
        for folder in folders:
            found += [Path(p) for p in glob.glob(str(folder / pattern))]
    apps = [p for p in found if p.is_dir() and (p / "Contents" / "Info.plist").is_file()]
    if not apps:
        return None
    # Several copies (e.g. /Applications and JetBrains Toolbox): use the newest version.
    best = max(apps, key=lambda p: _version_key(_mac_version(p)))
    return IDE(candidate["id"], candidate["name"], _mac_version(best), str(best), candidate["kind"],
               candidate.get("notes", ""))


def _detect_windows(candidate: dict) -> IDE | None:
    matches: list[str] = []
    for pattern in candidate["win"]:
        matches += glob.glob(os.path.expandvars(pattern))
    if not matches:
        command = {"vscode": "code", "intellij": "idea64", "eclipse": "eclipse"}.get(candidate["id"])
        resolved = shutil.which(command) if command else None
        if resolved:
            matches = [resolved]
    if not matches:
        return None
    executable = sorted(matches, key=lambda p: _version_key(p))[-1]
    return IDE(candidate["id"], candidate["name"], None, executable, candidate["kind"], candidate.get("notes", ""))


def _detect_linux(candidate: dict) -> IDE | None:
    for entry in candidate["linux"]:
        if "/" not in entry and not entry.startswith("~"):
            resolved = shutil.which(entry)
            if resolved:
                return IDE(candidate["id"], candidate["name"], None, resolved, candidate["kind"],
                           candidate.get("notes", ""))
            continue
        matches = sorted(glob.glob(os.path.expanduser(entry)), key=_version_key)
        if matches and os.access(matches[-1], os.X_OK):
            return IDE(candidate["id"], candidate["name"], None, matches[-1], candidate["kind"],
                       candidate.get("notes", ""))
    return None


def detect_ides(refresh: bool = False) -> list[IDE]:
    global _cache
    if _cache and not refresh and time.time() - _cache[0] < _CACHE_SECONDS:
        return _cache[1]
    detector = _detect_mac if sys.platform == "darwin" else _detect_windows if os.name == "nt" else _detect_linux
    ides = [ide for ide in (detector(c) for c in _CANDIDATES) if ide]
    _cache = (time.time(), ides)
    return ides


class IDEError(Exception):
    pass


def open_in_ide(ide_id: str, target: Path) -> IDE:
    """Launch the IDE (detached) with ``target`` (a folder or file that must already exist)."""
    ide = next((i for i in detect_ides() if i.id == ide_id), None)
    if not ide:
        raise IDEError(f"'{ide_id}' is not installed on this station.")
    if not target.exists():
        raise IDEError(f"'{target}' does not exist.")
    # Declared before the branches: mypy only checks the branch for the platform it runs on.
    kwargs: dict[str, Any] = {}
    if sys.platform == "darwin":
        argv = ["open", "-a", ide.executable, str(target)]
    elif os.name == "nt":
        argv = [ide.executable, str(target)]
        flags = getattr(subprocess, "DETACHED_PROCESS", 0x8) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)
        kwargs = {"creationflags": flags, "close_fds": True}
    else:
        argv = [ide.executable, str(target)]
        kwargs = {"start_new_session": True}
    try:
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, **kwargs)
    except OSError as exc:
        raise IDEError(f"Could not start {ide.name}: {exc}") from exc
    if sys.platform == "darwin":
        # `open` returns quickly; a non-zero exit means the app could not be launched.
        try:
            if process.wait(timeout=15) != 0:
                raise IDEError(f"macOS could not open {ide.name}.")
        except subprocess.TimeoutExpired:
            pass
    return ide


def station_name() -> str:
    import socket

    return socket.gethostname()
