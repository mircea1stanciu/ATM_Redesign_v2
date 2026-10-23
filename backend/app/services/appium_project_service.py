"""Analyse a linked Appium test project against the current station.

Supports the Java + Maven + Cucumber/TestNG layout: it discovers the runners and
TestNG suites the project can run, the device profiles it defines, and which
settings or station tools need to change before a run can succeed.

Only the files needed for this are read; credential files (e.g. DB property
files) are never opened and property values are only reported for known,
non-secret run settings.
"""
from __future__ import annotations

import asyncio
import difflib
import json
import os
import plistlib
import re
import shutil
import signal
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from pathlib import Path

from app.services import device_service
from app.services.device_service import _run as run_command

OK, WARNING, ERROR = "ok", "warning", "error"
_STATUS_RANK = {OK: 0, WARNING: 1, ERROR: 2}

MAX_JAVA_FILES = 5000
_TOOLS_TTL_SECONDS = 120
_tools_cache: dict[str, tuple[float, list[dict]]] = {}

_PACKAGE_RE = re.compile(r"^\s*package\s+([\w.]+)\s*;", re.M)
_CLASS_RE = re.compile(r"\bpublic\s+(?:final\s+)?class\s+(\w+)")
_TAGS_RE = re.compile(r"\btags\s*=\s*\"([^\"]*)\"")
_CASE_RE = re.compile(r"^\s*case\s+\"([^\"]+)\"\s*:")
_SETPROP_RE = re.compile(
    r"System\.setProperty\(\s*\"(\w+)\"\s*,\s*(?:String\.valueOf\(\s*)?(?:\"([^\"]*)\"|(\d+))"
)
_ENUM_VALUE_RE = re.compile(r"\b[A-Z_]+\(\s*\"([\w-]+)\"\s*\)")
_APP_ID_RE = re.compile(r"\b(\w*(?:PACKAGE|BUNDLE)\w*)\s*=\s*\"([A-Za-z][\w]*(?:\.[\w]+)+)\"")
_POM_TAG_RE = r"<{tag}>\s*([^<\s]+)\s*</{tag}>"

# Run settings from envProp.properties that are safe to display.
_RUN_SETTING_KEYS = ("appEnv", "deviceRunOption")


@dataclass
class Check:
    id: str
    title: str
    status: str
    message: str
    fix: str | None = None
    file: str | None = None
    line: int | None = None


@dataclass
class DeviceProfile:
    option: str
    aliases: list[str]
    platform: str  # android | ios
    device_name: str | None
    udid: str | None
    avd: str | None
    platform_version: str | None
    port: str | None
    file: str
    line: int
    status: str = OK
    issues: list[str] = field(default_factory=list)
    station_device: dict | None = None
    app_installed: bool | None = None
    suggestion: dict | None = None


# ── Repository parsing ───────────────────────────────────────────────────────

def detect_layout(repo: Path) -> str | None:
    pom = repo / "pom.xml"
    if pom.is_file() and "io.appium" in pom.read_text(errors="replace"):
        return "maven"
    return None


def _read(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except OSError:
        return ""


def _java_files(repo: Path) -> list[Path]:
    root = repo / "src" / "test" / "java"
    files = []
    for path in root.rglob("*.java") if root.is_dir() else []:
        files.append(path)
        if len(files) >= MAX_JAVA_FILES:
            break
    return files


def parse_pom(text: str) -> dict:
    def tag(name: str) -> str | None:
        match = re.search(_POM_TAG_RE.format(tag=re.escape(name)), text)
        return match.group(1) if match else None

    java_release = tag("maven.compiler.release") or tag("java.version") or tag("release")
    if java_release and not java_release.isdigit():
        java_release = None
    return {
        "java_release": int(java_release) if java_release else None,
        "appium_client_version": tag("java-client.version"),
        "has_xml_suite_profile": bool(re.search(r"<id>\s*XMLSuite\s*</id>", text)),
    }


def parse_properties(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(("#", "!")):
            continue
        match = re.match(r"([^=:\s]+)\s*[=:]\s*(.*)$", line)
        if match:
            values[match.group(1)] = match.group(2).strip()
    return values


_FEATURES_ATTR_RE = re.compile(r"\bfeatures\s*=\s*(\{[^}]*\}|\"[^\"]*\"|[A-Za-z_][\w.]*)")
_FEATURE_ITEM_RE = re.compile(r"\"([^\"]*)\"|([A-Za-z_][\w.]*)")
_STRING_CONST_RE = re.compile(r"\bstatic\s+final\s+String\s+(\w+)\s*=\s*\"([^\"]*)\"\s*;")
_TAG_METHOD_RE = re.compile(r"baseTagExpression\s*\(\s*\)\s*\{\s*return\s+((?:\"[^\"]*\"\s*\+?\s*)+);")


def parse_runner(text: str, constants: dict[str, str] | None = None) -> dict | None:
    if "@CucumberOptions" not in text or re.search(r"\babstract\s+class\b", text):
        return None
    class_match = _CLASS_RE.search(text)
    if not class_match:
        return None
    package_match = _PACKAGE_RE.search(text)
    package = package_match.group(1) if package_match else ""

    features: list[str] | None = None
    unresolved: list[str] = []
    attr = _FEATURES_ATTR_RE.search(text)
    if attr:
        features = []
        for literal, identifier in _FEATURE_ITEM_RE.findall(attr.group(1)):
            if identifier:
                value = (constants or {}).get(identifier.rsplit(".", 1)[-1])
                if value is None:
                    unresolved.append(identifier)
                    continue
                features.append(value)
            else:
                features.append(literal)

    tags_match = _TAGS_RE.search(text)
    tags = tags_match.group(1) if tags_match else None
    if tags is None:
        # Runners that build their tag expression in code, e.g. baseTagExpression().
        method = _TAG_METHOD_RE.search(text)
        if method:
            tags = "".join(re.findall(r"\"([^\"]*)\"", method.group(1))) or None
    return {
        "name": class_match.group(1),
        "class_name": f"{package}.{class_match.group(1)}" if package else class_match.group(1),
        "package": package,
        "features": ", ".join(features) if features else None,
        "feature_paths": features,
        "unresolved_constants": unresolved,
        "tags": tags,
    }


def _string_constants(java_files: list[Path]) -> dict[str, str]:
    constants: dict[str, str] = {}
    for path in java_files:
        text = _read(path)
        if "static final String" in text:
            constants.update(_STRING_CONST_RE.findall(text))
    return constants


def suggest_feature_path(repo: Path, rel_path: str) -> str | None:
    """Guess where a missing feature file/folder moved (renamed file or flattened folder)."""
    missing = repo / rel_path
    features_root = repo / "src" / "test" / "resources" / "features"
    if missing.suffix == ".feature":
        if missing.parent.is_dir():
            candidates = [p.name for p in missing.parent.glob("*.feature")]
            close = difflib.get_close_matches(missing.name, candidates, n=1, cutoff=0.6)
            if close:
                return (missing.parent / close[0]).relative_to(repo).as_posix()
        return None
    for parent in missing.parents:
        if parent == repo or repo not in parent.parents:
            break
        if parent.is_dir() and (parent == features_root or features_root in parent.parents):
            if next(parent.rglob("*.feature"), None):
                return parent.relative_to(repo).as_posix()
    return None


def _runner_group(package: str) -> str:
    parts = package.split(".")
    if "runners" in parts:
        rest = parts[parts.index("runners") + 1:]
        return "/".join(rest) or "runners"
    return package or "default"


def discover_runners(repo: Path, java_files: list[Path]) -> list[dict]:
    constants = _string_constants(java_files)
    runners = []
    for path in java_files:
        if "Runner" not in path.name:
            continue
        runner = parse_runner(_read(path), constants)
        if not runner:
            continue
        paths = runner.pop("feature_paths")
        unresolved = runner.pop("unresolved_constants")
        issue = note = suggestion = None
        if unresolved:
            issue = f"Could not resolve features constant {', '.join(unresolved)}"
        elif paths is None:
            note = "Features are chosen at runtime (no features attribute, e.g. a rerun-file runner)."
        else:
            missing = [p for p in paths if not (repo / p).exists()]
            if missing or not paths:
                issue = f"Feature path not found: {', '.join(missing) or '(empty)'}"
                suggestion = suggest_feature_path(repo, missing[0]) if missing else None
        runner.update({
            "group": _runner_group(runner["package"]),
            "path": path.relative_to(repo).as_posix(),
            "runnable": issue is None,
            "issue": issue,
            "note": note,
            "suggested_features": suggestion,
        })
        runners.append(runner)
    return sorted(runners, key=lambda r: (r["group"], r["name"]))


def discover_suites(repo: Path) -> list[dict]:
    resources = repo / "src" / "test" / "resources"
    suites = []
    for path in sorted(resources.glob("*/*.xml")) if resources.is_dir() else []:
        try:
            root = ET.parse(path).getroot()
        except (ET.ParseError, OSError):
            continue
        if root.tag != "suite":
            continue
        classes = [c.get("name", "") for c in root.iter("class") if c.get("name")]
        suites.append({
            "name": root.get("name") or path.stem,
            "folder": path.parent.name,
            "file": path.name,
            "path": path.relative_to(repo).as_posix(),
            "classes": classes,
        })
    return suites


def parse_device_profiles(text: str, rel_path: str) -> list[DeviceProfile]:
    """Parse ``switch (deviceRunOption)`` blocks of ``System.setProperty`` calls."""
    profiles: list[DeviceProfile] = []
    labels: list[tuple[str, int]] = []
    props: dict[str, str] = {}

    def flush():
        if labels and props:
            option, line = labels[0]
            platform = "ios" if option.startswith("i") else "android" if option.startswith("a") else None
            if platform:
                profiles.append(DeviceProfile(
                    option=option,
                    aliases=[label for label, _ in labels[1:]],
                    platform=platform,
                    device_name=props.get("deviceName"),
                    udid=props.get("deviceUDID"),
                    avd=props.get("avd"),
                    platform_version=props.get("platformVersion"),
                    port=props.get("systemPort") or props.get("wdaLocalPort"),
                    file=rel_path,
                    line=line,
                ))
        labels.clear()
        props.clear()

    for number, line in enumerate(text.splitlines(), start=1):
        case = _CASE_RE.match(line)
        if case:
            if props:
                flush()
            labels.append((case.group(1), number))
            continue
        if not labels:
            continue
        for key, quoted, digits in _SETPROP_RE.findall(line):
            props[key] = quoted if quoted else digits
        if re.match(r"^\s*(break\s*;|default\s*:)", line):
            flush()
    flush()
    return profiles


def _find_profiles_file(repo: Path, java_files: list[Path]) -> tuple[list[DeviceProfile], str | None]:
    for path in java_files:
        text = _read(path)
        if 'setProperty("deviceUDID"' in text and "case \"" in text:
            rel = path.relative_to(repo).as_posix()
            return parse_device_profiles(text, rel), rel
    return [], None


def _find_enum_values(java_files: list[Path], class_name: str) -> list[str]:
    for path in java_files:
        if path.stem == class_name:
            return _ENUM_VALUE_RE.findall(_read(path))
    return []


def _find_app_ids(java_files: list[Path]) -> dict[str, set[str]]:
    ids: dict[str, set[str]] = {"android": set(), "ios": set()}
    for path in java_files:
        if path.stem not in ("TestData", "Constants", "AppConstants"):
            continue
        for name, value in _APP_ID_RE.findall(_read(path)):
            ids["ios" if "BUNDLE" in name.upper() else "android"].add(value)
    return ids


# ── Station matching ─────────────────────────────────────────────────────────

def _norm_avd(name: str | None) -> str:
    return re.sub(r"[\s_]+", " ", name or "").strip().lower()


def find_android_device(devices: list[dict], avd: str | None) -> dict | None:
    """Match a profile's ``avd`` against AVD ids and display names ("Pixel_10a" / "Pixel 10a")."""
    wanted = _norm_avd(avd)
    if not wanted:
        return None
    return next((d for d in devices if d["platform"] == "android"
                 and wanted in (_norm_avd(d["id"]), _norm_avd(d["name"]))), None)


def android_version_for_api(api: str | None) -> str | None:
    match = re.search(r"(\d+)", api or "")
    if not match:
        return None
    level = int(match.group(1))
    known = {28: "9", 29: "10", 30: "11", 31: "12", 32: "12", 33: "13"}
    if level in known:
        return known[level]
    return str(level - 20) if level > 33 else None


def _version_matches(expected: str | None, actual: str | None) -> bool:
    if not expected or not actual:
        return True
    want = re.findall(r"\d+", expected)
    have = re.findall(r"\d+", actual)
    return bool(want and have) and want[: min(2, len(want))] == have[: min(2, len(want))]


def _ios_device_data_dir(udid: str) -> Path:
    return Path.home() / "Library" / "Developer" / "CoreSimulator" / "Devices" / udid / "data"


def ios_app_installed(udid: str, bundle_ids: set[str]) -> bool | None:
    if not bundle_ids:
        return None
    apps_root = _ios_device_data_dir(udid) / "Containers" / "Bundle" / "Application"
    if not apps_root.is_dir():
        return False
    for info_plist in apps_root.glob("*/*.app/Info.plist"):
        try:
            with open(info_plist, "rb") as handle:
                if plistlib.load(handle).get("CFBundleIdentifier") in bundle_ids:
                    return True
        except Exception:
            continue
    return False


async def android_app_installed(serial: str, packages: set[str]) -> bool | None:
    _, adb = device_service._android_tools()
    if not adb or not packages:
        return None
    _, out, _ = await run_command([adb, "-s", serial, "shell", "pm", "list", "packages"], timeout=20)
    installed = {line.strip().removeprefix("package:") for line in out.splitlines()}
    return bool(installed & packages)


def _worst(statuses) -> str:
    return max(statuses, key=lambda s: _STATUS_RANK[s], default=OK)


async def match_profile(profile: DeviceProfile, station: dict, app_ids: dict[str, set[str]]) -> DeviceProfile:
    platform_status = station["platforms"].get(profile.platform) or {}
    devices = [d for d in station["devices"] if d["platform"] == profile.platform]
    issues: list[tuple[str, str]] = []

    if not platform_status.get("available"):
        issues.append((ERROR, platform_status.get("reason") or f"{profile.platform} is not available on this station."))
    elif profile.platform == "ios":
        device = next((d for d in devices if d["id"].upper() == (profile.udid or "").upper()), None)
        if not device:
            issues.append((ERROR, f"Simulator {profile.udid} is not installed on this station."))
        else:
            profile.station_device = device
            if not _version_matches(profile.platform_version, device["os_version"]):
                issues.append((WARNING, f"platformVersion {profile.platform_version} but the simulator runs "
                                        f"{device['os_version']}."))
            profile.app_installed = ios_app_installed(device["id"], app_ids["ios"])
            if profile.app_installed is False:
                issues.append((ERROR, "The app under test is not installed on this simulator."))
            if device["state"] != "running":
                issues.append((WARNING, "Simulator is not booted (boot it from Test Run › Devices)."))
    else:
        avd_name = profile.avd or profile.device_name
        device = find_android_device(devices, avd_name)
        if not device:
            issues.append((ERROR, f"Android emulator (AVD) {avd_name} does not exist on this station."))
        else:
            profile.station_device = device
            actual_version = android_version_for_api(device["os_version"])
            if not _version_matches(profile.platform_version, actual_version):
                issues.append((WARNING, f"platformVersion {profile.platform_version} but the emulator runs "
                                        f"Android {actual_version or '?'} ({device['os_version']})."))
            if device["state"] != "running":
                issues.append((WARNING, "Emulator is not running (boot it from Test Run › Devices)."))
            else:
                if profile.udid and device.get("serial") and profile.udid != device["serial"]:
                    issues.append((ERROR, f"deviceUDID is {profile.udid} but the emulator runs as {device['serial']}."))
                profile.app_installed = await android_app_installed(device["serial"], app_ids["android"])
                if profile.app_installed is False:
                    issues.append((ERROR, "The app under test is not installed on this emulator."))

    profile.status = _worst(status for status, _ in issues)
    profile.issues = [message for _, message in issues]
    return profile


def best_station_device(platform: str, station: dict, app_ids: dict[str, set[str]]) -> dict | None:
    """Prefer a station device that has the app installed, then one that is running."""
    devices = [d for d in station["devices"] if d["platform"] == platform]
    if not devices:
        return None

    def score(device: dict) -> tuple:
        installed = ios_app_installed(device["id"], app_ids["ios"]) if platform == "ios" else None
        return (installed is True, device["state"] == "running")

    return max(devices, key=score)


def suggest_profile_edit(profile: DeviceProfile, target: dict | None) -> dict | None:
    """Return the setProperty edits that would point ``profile`` at ``target``."""
    if not target:
        return None
    changes: list[dict] = []
    if profile.platform == "ios":
        version = re.sub(r"^iOS\s*", "", target["os_version"] or "")
        if (profile.udid or "").upper() != target["id"].upper():
            changes.append({"key": "deviceUDID", "current": profile.udid, "suggested": target["id"]})
        if version and not _version_matches(profile.platform_version, version):
            changes.append({"key": "platformVersion", "current": profile.platform_version, "suggested": version})
    else:
        version = android_version_for_api(target["os_version"])
        serial = target.get("serial") or "emulator-5554"
        if profile.avd != target["id"]:
            changes.append({"key": "avd", "current": profile.avd, "suggested": target["id"]})
            changes.append({"key": "deviceName", "current": profile.device_name, "suggested": target["id"]})
        if profile.udid != serial:
            changes.append({"key": "deviceUDID", "current": profile.udid, "suggested": serial})
        if version and not _version_matches(profile.platform_version, version):
            changes.append({"key": "platformVersion", "current": profile.platform_version, "suggested": version})
    if not changes:
        return None
    return {"device": target, "changes": changes}


# ── Station tools ────────────────────────────────────────────────────────────

def _java_major(version_output: str) -> int | None:
    match = re.search(r'version\s+"(\d+)(?:\.(\d+))?', version_output)
    if not match:
        return None
    major = int(match.group(1))
    return int(match.group(2) or 0) if major == 1 else major


def _jdk_major(java_home: str | None) -> int | None:
    release_file = Path(java_home) / "release" if java_home else None
    if not release_file or not release_file.is_file():
        return None
    match = re.search(r'JAVA_VERSION="(\d+)(?:\.(\d+))?', _read(release_file))
    if not match:
        return None
    major = int(match.group(1))
    return int(match.group(2) or 0) if major == 1 else major


async def find_java(required: int | None) -> tuple[int | None, str | None]:
    """Return ``(default JDK major, JAVA_HOME of a JDK >= required if the default is older)``."""
    java = shutil.which("java")
    default_major = None
    if java:
        _, out, err = await run_command([java, "-version"], timeout=15)
        default_major = _java_major(err + out)
    if required is None or (default_major and default_major >= required):
        return default_major, None

    candidates = [os.environ.get("JAVA_HOME")]
    if device_service._os_family() == "macos" and Path("/usr/libexec/java_home").exists():
        # java_home falls back to another JDK when nothing matches, so the
        # returned path's version is verified below.
        code, out, _ = await run_command(["/usr/libexec/java_home", "-v", f"{required}+"], timeout=10)
        if code == 0 and out.strip():
            candidates.append(out.strip())
    alternative = next(
        (home for home in candidates if home and (_jdk_major(home) or 0) >= required), None
    )
    return default_major, alternative


async def _check_java(required: int | None) -> Check:
    default_major, alternative = await find_java(required)
    label = f"Java {required}+" if required else "Java"
    if required is None or (default_major and default_major >= required):
        if default_major:
            return Check("java", label, OK, f"Default JDK is Java {default_major}.")
        return Check("java", label, ERROR, "No Java runtime found on this station.", "Install a JDK.")

    found = f"Default JDK is Java {default_major}" if default_major else "No default JDK found"
    if alternative:
        return Check("java", label, WARNING, f"{found}; ATM runs will use the Java {required}+ JDK at {alternative}.",
                     f"For manual runs set JAVA_HOME={alternative}")
    return Check("java", label, ERROR, f"{found}, but pom.xml compiles for Java {required}.",
                 f"Install JDK {required} (e.g. Temurin {required}) and set JAVA_HOME to it.",
                 file="pom.xml")


async def _check_maven(repo: Path) -> Check:
    wrapper = "mvnw.cmd" if device_service.IS_WINDOWS else "mvnw"
    if (repo / wrapper).is_file():
        return Check("maven", "Maven", OK, f"Project includes the Maven wrapper ({wrapper}).")
    mvn = shutil.which("mvn")
    if not mvn:
        return Check("maven", "Maven", ERROR, "Maven (mvn) is not installed on this station.",
                     "Install Apache Maven and add it to PATH.")
    _, out, _ = await run_command([mvn, "-v"], timeout=30)
    first = out.strip().splitlines()[0] if out.strip() else "Maven"
    return Check("maven", "Maven", OK, first)


async def _check_appium(platforms: set[str]) -> list[Check]:
    appium = shutil.which("appium")
    if not appium:
        return [Check("appium", "Appium server", ERROR, "Appium is not installed on this station.",
                      "npm install -g appium")]
    _, version, _ = await run_command([appium, "-v"], timeout=30)
    checks = [Check("appium", "Appium server", OK, f"Appium {version.strip() or 'installed'}.")]
    code, out, _ = await run_command([appium, "driver", "list", "--installed", "--json"], timeout=60)
    try:
        installed = set(json.loads(out or "{}").keys()) if code == 0 else set()
    except json.JSONDecodeError:
        installed = set()
    for platform, driver in (("android", "uiautomator2"), ("ios", "xcuitest")):
        if platform not in platforms:
            continue
        if driver in installed:
            checks.append(Check(f"driver-{driver}", f"Appium {driver} driver", OK, "Installed."))
        else:
            checks.append(Check(f"driver-{driver}", f"Appium {driver} driver", ERROR, "Driver is not installed.",
                                f"appium driver install {driver}"))
    return checks


async def station_tool_checks(repo: Path, java_release: int | None, platforms: set[str],
                              refresh: bool = False) -> list[dict]:
    cache_key = f"{repo}|{java_release}|{','.join(sorted(platforms))}"
    cached = _tools_cache.get(cache_key)
    if cached and not refresh and time.monotonic() - cached[0] < _TOOLS_TTL_SECONDS:
        return cached[1]

    async def safe(coro, check_id: str, title: str):
        try:
            return await coro
        except device_service.DeviceError as exc:
            return Check(check_id, title, WARNING, f"Could not check: {exc.message}")

    java, maven, appium = await asyncio.gather(
        safe(_check_java(java_release), "java", "Java"),
        safe(_check_maven(repo), "maven", "Maven"),
        safe(_check_appium(platforms), "appium", "Appium server"),
    )
    checks = [java, maven, *(appium if isinstance(appium, list) else [appium])]
    result = [asdict(c) for c in checks]
    _tools_cache[cache_key] = (time.monotonic(), result)
    return result


# ── Entry point ──────────────────────────────────────────────────────────────

async def analyze_project(repo: Path, refresh: bool = False) -> dict:
    layout = detect_layout(repo)
    if not layout:
        return {"detected": False}

    java_files = _java_files(repo)
    pom = parse_pom(_read(repo / "pom.xml"))
    env_props_path = repo / "src" / "test" / "resources" / "envProp.properties"
    env_props = parse_properties(_read(env_props_path))
    settings = {key: env_props.get(key) for key in _RUN_SETTING_KEYS}
    app_env_values = _find_enum_values(java_files, "AppEnv")
    app_ids = _find_app_ids(java_files)

    runners = discover_runners(repo, java_files)
    suites = discover_suites(repo) if pom["has_xml_suite_profile"] else []
    profiles, profiles_file = _find_profiles_file(repo, java_files)

    station = await device_service.list_devices()
    profiles = list(await asyncio.gather(*(match_profile(p, station, app_ids) for p in profiles)))
    platforms = {p.platform for p in profiles} or {"android", "ios"}
    best_device = {platform: best_station_device(platform, station, app_ids) for platform in platforms}
    for profile in profiles:
        if profile.status != OK:
            profile.suggestion = suggest_profile_edit(profile, best_device.get(profile.platform))
    checks: list[dict] = await station_tool_checks(repo, pom["java_release"], platforms, refresh)
    checks = [dict(c) for c in checks]

    env_rel = env_props_path.relative_to(repo).as_posix()
    app_env = settings.get("appEnv")
    if app_env_values and app_env not in app_env_values:
        checks.append(asdict(Check("app-env", "appEnv", ERROR,
                                   f"appEnv is '{app_env or ''}'; valid values: {', '.join(app_env_values)}.",
                                   f"Set appEnv to one of: {', '.join(app_env_values)}", env_rel)))
    elif app_env:
        user_props = repo / "src" / "test" / "resources" / "userProps" / f"userProp_{app_env}.properties"
        if user_props.is_file():
            checks.append(asdict(Check("app-env", "appEnv", OK, f"appEnv={app_env} (test data file present).")))
        else:
            checks.append(asdict(Check("app-env", "appEnv", ERROR, f"Missing test data file for appEnv={app_env}.",
                                       f"Create {user_props.relative_to(repo).as_posix()}", env_rel)))

    option = settings.get("deviceRunOption")
    selected = next((p for p in profiles if option in (p.option, *p.aliases)), None)
    suggestion = None
    if not profiles:
        checks.append(asdict(Check("device-profile", "Device profile", WARNING,
                                   "No device profiles (deviceRunOption switch) found in the project.")))
    elif not selected:
        checks.append(asdict(Check("device-profile", "Device profile", ERROR,
                                   f"deviceRunOption '{option or ''}' is not defined in {profiles_file}.",
                                   "Set deviceRunOption to one of the profiles listed below.", env_rel)))
    else:
        ready = [p for p in profiles if p.status == OK]
        if selected.status == OK:
            device_name = selected.station_device["name"]
            checks.append(asdict(Check("device-profile", "Device profile", OK,
                                       f"{selected.option} matches {device_name} on this station.")))
        else:
            fix = None
            if ready:
                fix = f"Set deviceRunOption={ready[0].option} (ready on this station)"
            suggestion = selected.suggestion
            if suggestion and not fix:
                edits = ", ".join(f"{c['key']} → {c['suggested']}" for c in suggestion["changes"])
                fix = f"Update profile {selected.option}: {edits}"
            checks.append(asdict(Check("device-profile", f"Device profile {selected.option}", selected.status,
                                       " ".join(selected.issues), fix, selected.file, selected.line)))

    return {
        "detected": True,
        "layout": layout,
        "repo_path": str(repo),
        "framework": {
            "language": "Java",
            "build": "Maven",
            "test_runner": "Cucumber + TestNG",
            "java_release": pom["java_release"],
            "appium_client_version": pom["appium_client_version"],
        },
        "settings": {
            "file": env_rel,
            "app_env": app_env,
            "app_env_values": app_env_values,
            "app_env_ready": {
                value: (repo / "src" / "test" / "resources" / "userProps" / f"userProp_{value}.properties").is_file()
                for value in app_env_values
            },
            "device_run_option": option,
        },
        "station": station["station"],
        "checks": checks,
        "profiles": [asdict(p) for p in profiles],
        "profiles_file": profiles_file,
        "selected_profile_suggestion": suggestion,
        "runners": runners,
        "suites": suites,
        "commands": {
            "runner": "mvn test -Dtest={runner}",
            "suite": "mvn test -PXMLSuite -DtestTypePackage={folder} -DsuiteXmlFile={file}",
        },
    }


# ── Running ──────────────────────────────────────────────────────────────────

APPIUM_TARGET_PREFIX = "appium:"
_JAVA_CLASS_RE = re.compile(r"^[A-Za-z_$][\w$]{0,127}$")
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")


@dataclass
class AppiumRunPlan:
    argv: list[str]
    cwd: str
    env: dict[str, str]
    target: str
    label: str
    app_env: str
    device_run_option: str
    java_home: str | None = None
    warnings: list[str] = field(default_factory=list)
    # Metadata used to describe the run afterwards (Run details).
    meta: dict = field(default_factory=dict)


def _maven_command(repo: Path) -> str:
    wrapper = repo / ("mvnw.cmd" if device_service.IS_WINDOWS else "mvnw")
    if wrapper.is_file():
        return str(wrapper)
    mvn = shutil.which("mvn")
    if not mvn:
        raise ValueError("Maven (mvn) is not installed on this station and the project has no Maven wrapper.")
    return mvn


async def build_run_plan(repo: Path, target: str, app_env: str, device_run_option: str) -> AppiumRunPlan:
    """Validate a run request against the project and build the Maven command.

    ``target`` is ``runner:<RunnerClass>`` or ``suite:<folder>/<file.xml>``.
    Raises ``ValueError`` with a user-facing message when something is invalid.
    """
    if detect_layout(repo) != "maven":
        raise ValueError("The linked checkout is not an Appium Maven project.")
    java_files = _java_files(repo)
    pom = parse_pom(_read(repo / "pom.xml"))

    kind, _, name = (target or "").partition(":")
    if kind == "runner":
        runner = next((r for r in discover_runners(repo, java_files) if r["name"] == name), None)
        if not _JAVA_CLASS_RE.match(name) or not runner:
            raise ValueError(f"Runner '{name}' was not found in the project.")
        if not runner["runnable"]:
            raise ValueError(runner["issue"] or f"Runner '{name}' cannot be run.")
        selector = [f"-Dtest={name}"]
        label = name
        target_meta = {"kind": "runner", "name": name, "class_name": runner["class_name"],
                       "features": runner["features"], "tags": runner["tags"]}
    elif kind == "suite":
        folder, _, file = name.partition("/")
        suite = next((s for s in discover_suites(repo) if s["folder"] == folder and s["file"] == file), None)
        if not (_SAFE_NAME_RE.match(folder) and _SAFE_NAME_RE.match(file)) or not suite:
            raise ValueError(f"TestNG suite '{name}' was not found in the project.")
        if not pom["has_xml_suite_profile"]:
            raise ValueError("pom.xml has no XMLSuite profile, so TestNG suites cannot be selected.")
        selector = ["-PXMLSuite", f"-DtestTypePackage={folder}", f"-DsuiteXmlFile={file}"]
        label = f"{suite['name']} ({folder})"
        target_meta = {"kind": "suite", "name": suite["name"], "file": f"{folder}/{file}",
                       "classes": suite["classes"]}
    else:
        raise ValueError("Select a Cucumber runner or a TestNG suite.")

    app_env_values = _find_enum_values(java_files, "AppEnv")
    if not _SAFE_NAME_RE.match(app_env or "") or (app_env_values and app_env not in app_env_values):
        raise ValueError(f"Invalid appEnv '{app_env}'. Valid values: {', '.join(app_env_values) or '—'}.")

    profiles, profiles_file = _find_profiles_file(repo, java_files)
    options = {"be"} | {o for p in profiles for o in (p.option, *p.aliases)}
    if not _SAFE_NAME_RE.match(device_run_option or "") or (profiles and device_run_option not in options):
        raise ValueError(f"Device profile '{device_run_option}' is not defined in {profiles_file or 'the project'}.")

    argv = [_maven_command(repo), "-B", "-Dstyle.color=never", "test", *selector,
            f"-DappEnv={app_env}", f"-DdeviceRunOption={device_run_option}"]
    env = {**os.environ, "NO_COLOR": "1"}
    plan = AppiumRunPlan(argv, str(repo), env, f"{kind}:{name}", label, app_env, device_run_option)
    profile = next((p for p in profiles if device_run_option in (p.option, *p.aliases)), None)
    app_ids = _find_app_ids(java_files)
    plan.meta = {
        "app_env": app_env,
        "device_run_option": device_run_option,
        "target": target_meta,
        "profile": asdict(profile) if profile else None,
        "profile_options": sorted(options - {"be"}),
        "app_ids": {k: sorted(v) for k, v in app_ids.items()},
        "framework": {
            "test_runner": "Cucumber + TestNG",
            "build": "Maven",
            "java_release": pom["java_release"],
            "appium_java_client": pom["appium_client_version"],
        },
    }

    required = pom["java_release"]
    default_major, alternative = await find_java(required)
    if alternative:
        plan.java_home = alternative
        env["JAVA_HOME"] = alternative
        env["PATH"] = str(Path(alternative) / "bin") + os.pathsep + env.get("PATH", "")
    elif required and (default_major or 0) < required:
        plan.warnings.append(
            f"pom.xml compiles for Java {required} but this station's JDK is "
            f"{default_major or 'missing'}; the build will likely fail. Install JDK {required}."
        )
    return plan


def collect_surefire_results(repo: Path, since: float) -> dict | None:
    """Merge the JUnit XML reports Surefire wrote during this run (mtime >= ``since``)."""
    from app.services.junit_parser import JunitParser

    reports_dir = repo / "target" / "surefire-reports"
    files = [p for p in reports_dir.glob("TEST-*.xml") if p.stat().st_mtime >= since] if reports_dir.is_dir() else []
    if not files:
        return None
    merged = {"test_results": [], "total_tests": 0, "passed_tests": 0, "failed_tests": 0, "skipped_tests": 0}
    for path in sorted(files):
        try:
            parsed = JunitParser.parse_string(path.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        merged["test_results"].extend(parsed["results"])
        merged["total_tests"] += parsed["totals"]["tests"]
        merged["passed_tests"] += parsed["totals"]["passed"]
        merged["failed_tests"] += parsed["totals"]["failed"]
        merged["skipped_tests"] += parsed["totals"]["skipped"]
    return merged if merged["test_results"] else None


def copy_new_allure_results(repo: Path, since: float, target_dir: Path) -> int:
    """Copy Allure result files produced during this run into ``target_dir``."""
    source = repo / "target" / "allure-results"
    if not source.is_dir():
        return 0
    new_files = [p for p in source.iterdir() if p.is_file() and p.stat().st_mtime >= since]
    if not new_files:
        return 0
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True)
    for path in new_files:
        shutil.copy2(path, target_dir / path.name)
    return len(new_files)


def process_group_kwargs() -> dict:
    """Start runs in their own process group so cancel can stop Maven and its forked JVMs."""
    if device_service.IS_WINDOWS:
        return {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)}
    return {"start_new_session": True}


def terminate_process_tree(pid: int) -> None:
    if device_service.IS_WINDOWS:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False)
        return
    if not owns_process_group(pid):
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass


def pid_alive(pid: int) -> bool:
    """True if a process with ``pid`` is still running (never signals it)."""
    if pid <= 0:
        return False
    if device_service.IS_WINDOWS:
        import ctypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        # Reap it if it is our own exited child (a zombie still accepts signal 0).
        if os.waitpid(pid, os.WNOHANG)[0] == pid:
            return False
    except ChildProcessError:
        pass
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def owns_process_group(pid: int) -> bool:
    """Runs are started as their own process group; guard against a reused pid."""
    if device_service.IS_WINDOWS:
        return pid_alive(pid)
    try:
        return os.getpgid(pid) == pid
    except (ProcessLookupError, PermissionError):
        return False


# ── Run details ──────────────────────────────────────────────────────────────

_REPORT_EXTENSIONS = {".html", ".htm", ".pdf", ".json", ".xlsx", ".docx", ".zip"}
_REPORT_SKIP_DIRS = {".git", "node_modules", "classes", "test-classes", "allure-results", ".automationtestmanager",
                     "derivedDataPathWebDriverAgent", "surefire-reports", "maven-status", "generated-test-sources"}
_MAX_REPORTS = 20
_MAX_REPORT_BYTES = 50 * 1024 * 1024
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _ios_app_bundles(udid: str) -> list[Path]:
    apps_root = _ios_device_data_dir(udid) / "Containers" / "Bundle" / "Application"
    return list(apps_root.glob("*/*.app")) if apps_root.is_dir() else []


def ios_app_version(udid: str, bundle_ids: set[str]) -> dict | None:
    """Version of the app under test installed on an iOS simulator (from Info.plist)."""
    for bundle in _ios_app_bundles(udid):
        try:
            with open(bundle / "Info.plist", "rb") as handle:
                info = plistlib.load(handle)
        except Exception:
            continue
        if info.get("CFBundleIdentifier") in bundle_ids:
            return {
                "name": info.get("CFBundleDisplayName") or info.get("CFBundleName") or bundle.stem,
                "id": info.get("CFBundleIdentifier"),
                "version": info.get("CFBundleShortVersionString"),
                "build": info.get("CFBundleVersion"),
                "source": "simulator app bundle",
            }
    return None


async def android_app_version(serial: str, packages: set[str]) -> dict | None:
    """Version of the app under test installed on an Android emulator (dumpsys)."""
    _, adb = device_service._android_tools()
    if not adb:
        return None
    for package in sorted(packages):
        try:
            _, out, _ = await run_command([adb, "-s", serial, "shell", "dumpsys", "package", package], timeout=20)
        except device_service.DeviceError:
            return None
        name = re.search(r"versionName=(\S+)", out)
        code = re.search(r"versionCode=(\d+)", out)
        if name or code:
            return {"name": package, "id": package, "version": name.group(1) if name else None,
                    "build": code.group(1) if code else None, "source": "adb dumpsys"}
    return None


async def _android_serial_for(meta: dict, serial_hint: str | None = None) -> str | None:
    """Serial of the running emulator a run uses: the profile's deviceUDID if it is
    running (that is what the framework connects to), else the profile's AVD."""
    profile = meta.get("profile") or {}
    _, devices = await device_service.list_android()
    running = [d for d in devices if d.serial]
    for serial in (serial_hint, profile.get("udid")):
        if serial and any(d.serial == serial for d in running):
            return serial
    device = find_android_device([d.to_dict() for d in running], profile.get("avd") or profile.get("device_name"))
    return device["serial"] if device else None


async def detect_app_version(meta: dict) -> dict | None:
    """App version on the run's target device, or None if it cannot be determined."""
    profile = meta.get("profile") or {}
    app_ids = {k: set(v) for k, v in (meta.get("app_ids") or {}).items()}
    try:
        if profile.get("platform") == "ios" and profile.get("udid"):
            return await asyncio.to_thread(ios_app_version, profile["udid"], app_ids.get("ios", set()))
        if profile.get("platform") == "android":
            serial = await _android_serial_for(meta)
            if serial:
                return await android_app_version(serial, app_ids.get("android", set()))
    except Exception:
        return None
    return None


def parse_run_log(text: str) -> dict:
    """Pick versions/capabilities the framework printed while running."""
    text = _ANSI_RE.sub("", text)
    info: dict = {}
    match = re.search(r"Appium (?:npm )?server version:\s*([\w.\-]+)", text)
    if match:
        info["appium_server"] = match.group(1)
    match = re.search(r"Version and number:\s*([^\s-]+)-([^\s-]+)-([^\s]+)", text)
    if match:
        info["app"] = {"name": match.group(1), "version": match.group(2), "build": match.group(3),
                       "source": "test framework log"}
    caps = re.findall(r"Capabilities \{([^\n]*)\}", text)
    for line in reversed(caps):
        if "platformName" in line:
            fields = dict(re.findall(r"(?:appium:)?(\w+): ([^,}]+)", line))
            info["capabilities"] = {
                key: fields[key].strip() for key in
                ("platformName", "platformVersion", "deviceName", "udid", "automationName", "bundleId", "appPackage")
                if key in fields
            }
            break
    return info


async def technology_versions(platform: str | None, java_home: str | None) -> dict:
    versions: dict = {}
    java = str(Path(java_home) / "bin" / "java") if java_home else shutil.which("java")
    try:
        if java:
            _, out, err = await run_command([java, "-version"], timeout=15)
            match = re.search(r'version\s+"([^"]+)"', err + out)
            versions["java"] = match.group(1) if match else None
        mvn = shutil.which("mvn")
        if mvn:
            _, out, _ = await run_command([mvn, "-v"], timeout=30)
            match = re.search(r"Apache Maven ([\w.\-]+)", out)
            versions["maven"] = match.group(1) if match else None
        appium = shutil.which("appium")
        if appium:
            _, out, _ = await run_command([appium, "-v"], timeout=30)
            versions["appium_server"] = out.strip() or None
            code, out, _ = await run_command([appium, "driver", "list", "--installed", "--json"], timeout=60)
            drivers = json.loads(out or "{}") if code == 0 else {}
            driver = "xcuitest" if platform == "ios" else "uiautomator2" if platform == "android" else None
            if driver and driver in drivers:
                versions["appium_driver"] = {"name": driver, "version": drivers[driver].get("version")}
        if platform == "ios":
            versions["xcode"] = (await device_service.xcode_info()).get("xcode_version")
    except (device_service.DeviceError, ValueError):
        pass
    return {k: v for k, v in versions.items() if v}


def find_generated_reports(repo: Path, since: float, until: float, own_option: str | None,
                           other_options: list[str]) -> list[Path]:
    """Report documents written during the run (HTML/PDF/JSON…), excluding ones that
    belong to another device profile (e.g. a run started outside ATM)."""
    found: list[Path] = []
    others = [o for o in other_options if o and o != own_option]

    def belongs_to_other_run(rel: str) -> bool:
        tokens = set(re.split(r"[\\/_.\-]", rel))
        return any(option in tokens for option in others) and not (own_option and own_option in tokens)

    def walk(directory: Path) -> None:
        try:
            children = list(directory.iterdir())
        except OSError:
            return
        for child in children:
            if len(found) >= _MAX_REPORTS or child.is_symlink():
                continue
            if child.is_dir():
                if child.name not in _REPORT_SKIP_DIRS:
                    walk(child)
                continue
            if child.suffix.lower() not in _REPORT_EXTENSIONS:
                continue
            rel = child.relative_to(repo).as_posix()
            is_report = "report" in rel.lower() or child.suffix.lower() in {".pdf", ".docx", ".xlsx"}
            try:
                stat = child.stat()
            except OSError:
                continue
            if is_report and since <= stat.st_mtime <= until and stat.st_size <= _MAX_REPORT_BYTES \
                    and not belongs_to_other_run(rel):
                found.append(child)

    walk(repo)
    return sorted(found, key=lambda p: (p.suffix.lower() != ".html", p.as_posix()))


def store_reports(repo: Path, reports: list[Path], target_dir: Path) -> list[dict]:
    """Copy reports into the run's artifact folder so later runs cannot overwrite them."""
    stored = []
    target_dir.mkdir(parents=True, exist_ok=True)
    for index, path in enumerate(reports):
        destination = target_dir / f"{index:02d}-{path.name}"
        shutil.copy2(path, destination)
        stored.append({
            "name": path.name,
            "source": path.relative_to(repo).as_posix(),
            "file": destination.name,
            "kind": path.suffix.lower().lstrip("."),
            "size": destination.stat().st_size,
        })
    return stored


async def build_run_details(repo: Path, artifact_dir: Path, meta: dict, started: float, finished: float,
                            exit_code: int | None, app_before: dict | None, java_home: str | None,
                            command: list[str]) -> dict:
    profile = meta.get("profile") or {}
    platform = profile.get("platform")
    log_text = ""
    log_path = artifact_dir / "process.log"
    if log_path.is_file():
        log_text = log_path.read_text(encoding="utf-8", errors="replace")
    from_log = parse_run_log(log_text)

    app = await detect_app_version(meta) or app_before or from_log.get("app")
    if app and app is app_before:
        app = {**app, "source": f"{app.get('source')} (before the run)"}

    caps = from_log.get("capabilities", {})
    caps_udid = caps.get("udid") if "..." not in (caps.get("udid") or "") else None
    device = None
    try:
        station = await device_service.list_devices()
        if platform == "ios":
            udid = (profile.get("udid") or caps_udid or "").upper()
            device = next((d for d in station["devices"] if d["platform"] == "ios" and d["id"].upper() == udid), None)
        elif platform == "android":
            serial = await _android_serial_for(meta, caps_udid)
            device = next((d for d in station["devices"] if serial and d.get("serial") == serial), None)
    except Exception:
        station = None

    tech = await technology_versions(platform, java_home)
    if from_log.get("appium_server"):
        tech["appium_server"] = from_log["appium_server"]
    tech.update({k: v for k, v in (meta.get("framework") or {}).items() if v})

    reports = find_generated_reports(repo, started, finished + 60, profile.get("option"),
                                     meta.get("profile_options") or [])
    stored_reports = store_reports(repo, reports, artifact_dir / "reports") if reports else []

    return {
        "type": "appium",
        "command": command,
        "target": meta.get("target"),
        "app_env": meta.get("app_env"),
        "device_run_option": profile.get("option") or meta.get("device_run_option"),
        "duration_seconds": round(max(0.0, finished - started), 1),
        "exit_code": exit_code,
        "app": app,
        "device": {
            "platform": {"ios": "iOS", "android": "Android"}.get(platform or "", caps.get("platformName")),
            "platform_version": caps.get("platformVersion") or profile.get("platform_version"),
            "name": (device or {}).get("name") or caps.get("deviceName") or profile.get("device_name"),
            "os": (device or {}).get("os_version"),
            "id": (device or {}).get("serial") or profile.get("udid") or caps_udid,
            "automation": caps.get("automationName"),
        },
        "technology": tech,
        "station": (station or {}).get("station"),
        "reports": stored_reports,
    }
