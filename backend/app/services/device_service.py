"""Discover and control the Android emulators and iOS simulators installed on
the backend host ("station") — Android SDK ``emulator``/``adb`` on macOS,
Windows and Linux, and Xcode ``xcrun simctl`` on macOS.

Commands are always executed without a shell, and device identifiers are only
accepted if they match a device discovered on the host.
"""
from __future__ import annotations

import asyncio
import getpass
import json
import os
import platform as host_platform
import re
import shutil
import socket
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from app.core.config import settings

ANDROID = "android"
IOS = "ios"

IS_WINDOWS = os.name == "nt"

# Windows process flags (defined only on Windows builds of Python).
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
_DETACHED_FLAGS = getattr(subprocess, "DETACHED_PROCESS", 0x00000008) | getattr(
    subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200
)

AVD_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
UDID_RE = re.compile(r"^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$")
_ANDROID_API_RE = re.compile(r"android-(\d+(?:\.\d+)?)")
_IOS_RUNTIME_RE = re.compile(r"SimRuntime\.iOS-(\d+)(?:-(\d+))?(?:-(\d+))?$")

# How long a just-requested boot/stop is reported as "booting"/"stopping"
# before the host tools reflect the new state.
_TRANSITION_GRACE_SECONDS = 180
_XCODE_INFO_TTL_SECONDS = 300

_SIMCTL_STATES = {
    "Booted": "running",
    "Booting": "booting",
    "Shutting Down": "stopping",
    "Shutdown": "stopped",
}

# (platform, device_id) -> (target_state, monotonic timestamp)
_pending: dict[tuple[str, str], tuple[str, float]] = {}
_xcode_cache: dict[str, object] = {}


class DeviceError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class MobileDevice:
    id: str
    platform: str
    name: str
    os_version: str | None
    state: str  # stopped | booting | running | stopping
    serial: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AndroidTooling:
    sdk_path: str | None = None
    source: str | None = None
    emulator: str | None = None
    adb: str | None = None


def _run_sync(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
    extra = {"creationflags": _CREATE_NO_WINDOW} if IS_WINDOWS else {}
    return subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, **extra)


async def _run(cmd: list[str], timeout: float = 20) -> tuple[int, str, str]:
    # Run in a worker thread: asyncio subprocesses are unavailable on the
    # Windows selector event loop that uvicorn may use.
    try:
        proc = await asyncio.to_thread(_run_sync, cmd, timeout)
    except subprocess.TimeoutExpired as exc:
        raise DeviceError(f"{Path(cmd[0]).name} timed out", 504) from exc
    except OSError as exc:
        raise DeviceError(f"Unable to run {Path(cmd[0]).name}: {exc}", 500) from exc
    return proc.returncode, proc.stdout.decode(errors="replace"), proc.stderr.decode(errors="replace")


def _apply_pending(device: MobileDevice) -> MobileDevice:
    key = (device.platform, device.id)
    pending = _pending.get(key)
    if not pending:
        return device
    target, started = pending
    reached = (target == "running" and device.state == "running") or (
        target == "stopped" and device.state == "stopped"
    )
    if reached or time.monotonic() - started > _TRANSITION_GRACE_SECONDS:
        _pending.pop(key, None)
        return device
    device.state = "booting" if target == "running" else "stopping"
    return device


# ── Station ──────────────────────────────────────────────────────────────────

def _os_family() -> str:
    system = host_platform.system()
    return {"Darwin": "macos", "Windows": "windows", "Linux": "linux"}.get(system, "other")


def _os_label() -> str:
    system = host_platform.system()
    if system == "Darwin":
        name = f"macOS {host_platform.mac_ver()[0]}".strip()
    elif system == "Windows":
        release, build = host_platform.release(), host_platform.version().split(".")[-1]
        # Older Pythons report Windows 11 as release "10"; builds >= 22000 are Windows 11.
        if release == "10" and build.isdigit() and int(build) >= 22000:
            release = "11"
        name = f"Windows {release} (build {build})"
    elif system == "Linux":
        try:
            name = host_platform.freedesktop_os_release().get("PRETTY_NAME") or "Linux"
        except (AttributeError, OSError):
            name = f"Linux {host_platform.release()}"
    else:
        name = f"{system} {host_platform.release()}".strip()
    machine = host_platform.machine()
    return f"{name} ({machine})" if machine else name


def station_info() -> dict:
    try:
        user = getpass.getuser()
    except Exception:
        user = None
    return {"hostname": socket.gethostname(), "os": _os_label(), "os_family": _os_family(), "user": user}


# ── Android ──────────────────────────────────────────────────────────────────

def _sdk_candidates() -> list[tuple[str, str]]:
    home = Path.home()
    default = "Android Studio default location"
    candidates = [
        (settings.ANDROID_SDK_ROOT or os.environ.get("ANDROID_SDK_ROOT", ""), "ANDROID_SDK_ROOT"),
        (os.environ.get("ANDROID_HOME", ""), "ANDROID_HOME"),
    ]
    if IS_WINDOWS:
        local_app_data = os.environ.get("LOCALAPPDATA") or str(home / "AppData" / "Local")
        candidates.append((str(Path(local_app_data) / "Android" / "Sdk"), default))
    else:
        candidates.append((str(home / "Library" / "Android" / "sdk"), default))
        candidates.append((str(home / "Android" / "Sdk"), default))
    return candidates


def _tool(sdk: Path, folder: str, name: str) -> str | None:
    path = sdk / folder / (f"{name}.exe" if IS_WINDOWS else name)
    return str(path) if path.is_file() and os.access(path, os.X_OK) else None


def android_tooling() -> AndroidTooling:
    """Locate the station's Android SDK (emulator + adb) and how it was found."""
    for raw_path, source in _sdk_candidates():
        if not raw_path:
            continue
        sdk = Path(raw_path).expanduser()
        if not sdk.is_dir():
            continue
        emulator, adb = _tool(sdk, "emulator", "emulator"), _tool(sdk, "platform-tools", "adb")
        if emulator or adb:
            return AndroidTooling(
                str(sdk), source, emulator or shutil.which("emulator"), adb or shutil.which("adb")
            )
    emulator, adb = shutil.which("emulator"), shutil.which("adb")
    if emulator or adb:
        # <sdk>/emulator/emulator or <sdk>/platform-tools/adb
        sdk_path = str(Path(emulator or adb).resolve().parent.parent)
        return AndroidTooling(sdk_path, "PATH", emulator, adb)
    return AndroidTooling()


def _android_tools() -> tuple[str | None, str | None]:
    tooling = android_tooling()
    return tooling.emulator, tooling.adb


def _avd_home() -> Path:
    if os.environ.get("ANDROID_AVD_HOME"):
        return Path(os.environ["ANDROID_AVD_HOME"]).expanduser()
    if os.environ.get("ANDROID_USER_HOME"):
        return Path(os.environ["ANDROID_USER_HOME"]).expanduser() / "avd"
    return Path.home() / ".android" / "avd"


def parse_avd_list(output: str) -> list[str]:
    return [line.strip() for line in output.splitlines() if AVD_NAME_RE.match(line.strip())]


def parse_adb_devices(output: str) -> list[tuple[str, str]]:
    """Return ``(serial, state)`` for emulator entries of ``adb devices``."""
    devices = []
    for line in output.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and parts[0].startswith("emulator-"):
            devices.append((parts[0], parts[1]))
    return devices


def parse_emu_avd_name(output: str) -> str | None:
    for line in output.splitlines():
        value = line.strip()
        if value and value != "OK":
            return value
    return None


def read_avd_metadata(avd_name: str) -> tuple[str, str | None]:
    """Return ``(display_name, os_version)`` from the AVD's config.ini."""
    config_path = _avd_home() / f"{avd_name}.avd" / "config.ini"
    values: dict[str, str] = {}
    try:
        for line in config_path.read_text(errors="replace").splitlines():
            key, sep, value = line.partition("=")
            if sep:
                values[key.strip()] = value.strip()
    except OSError:
        pass
    display_name = values.get("avd.ini.displayname") or avd_name.replace("_", " ")
    match = _ANDROID_API_RE.search(values.get("image.sysdir.1", "") or values.get("target", ""))
    return display_name, (f"Android API {match.group(1)}" if match else None)


async def _android_running() -> dict[str, tuple[str, bool]]:
    """Map AVD name -> (adb serial, fully booted) for running emulators."""
    _, adb = _android_tools()
    if not adb:
        return {}
    _, out, _ = await _run([adb, "devices"])
    running: dict[str, tuple[str, bool]] = {}
    for serial, state in parse_adb_devices(out):
        _, name_out, _ = await _run([adb, "-s", serial, "emu", "avd", "name"], timeout=10)
        avd_name = parse_emu_avd_name(name_out)
        if not avd_name:
            continue
        booted = False
        if state == "device":
            _, prop, _ = await _run([adb, "-s", serial, "shell", "getprop", "sys.boot_completed"], timeout=10)
            booted = prop.strip() == "1"
        running[avd_name] = (serial, booted)
    return running


async def list_android() -> tuple[dict, list[MobileDevice]]:
    tooling = android_tooling()
    if not tooling.emulator or not tooling.adb:
        tools = (("emulator", tooling.emulator), ("adb", tooling.adb))
        missing = " and ".join(name for name, path in tools if not path)
        if tooling.sdk_path:
            reason = (
                f"Android SDK at {tooling.sdk_path} is missing {missing}. "
                "Install them from Android Studio › SDK Manager."
            )
        else:
            location = r"%LOCALAPPDATA%\Android\Sdk" if IS_WINDOWS else "its default location"
            reason = (
                f"Android SDK not found on this station. Install Android Studio (SDK in {location}) "
                "or set ANDROID_SDK_ROOT."
            )
        return {"available": False, "reason": reason, "tooling": asdict(tooling)}, []

    _, avd_out, _ = await _run([tooling.emulator, "-list-avds"])
    running = await _android_running()
    devices = []
    for avd_name in parse_avd_list(avd_out):
        display_name, os_version = read_avd_metadata(avd_name)
        serial, booted = running.get(avd_name, (None, False))
        state = "stopped" if serial is None else ("running" if booted else "booting")
        devices.append(_apply_pending(MobileDevice(avd_name, ANDROID, display_name, os_version, state, serial)))
    return {"available": True, "reason": None, "tooling": asdict(tooling)}, devices


def _device_log_path(platform: str, device_id: str) -> Path:
    log_dir = Path(settings.ARTIFACTS_DIR) / "device-logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / f"{platform}-{device_id}.log"


async def _boot_android(device: MobileDevice) -> None:
    emulator, _ = _android_tools()
    if not emulator:
        raise DeviceError("Android emulator binary not found", 503)
    # Detached so the emulator keeps running across backend restarts.
    detach = {"creationflags": _DETACHED_FLAGS} if IS_WINDOWS else {"start_new_session": True}
    with open(_device_log_path(ANDROID, device.id), "ab") as log:
        subprocess.Popen(
            [emulator, "-avd", device.id],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            **detach,
        )


async def _stop_android(device: MobileDevice) -> None:
    _, adb = _android_tools()
    if not adb or not device.serial:
        raise DeviceError("Android emulator is not running", 409)
    code, out, err = await _run([adb, "-s", device.serial, "emu", "kill"])
    if code != 0:
        raise DeviceError(f"adb emu kill failed: {(err or out).strip()[:200]}", 502)


# ── iOS ──────────────────────────────────────────────────────────────────────

def ios_runtime_label(runtime_id: str) -> str | None:
    match = _IOS_RUNTIME_RE.search(runtime_id)
    if not match:
        return None
    return "iOS " + ".".join(part for part in match.groups() if part is not None)


def parse_simctl_devices(payload: str) -> list[MobileDevice]:
    data = json.loads(payload or "{}")
    devices = []
    for runtime_id, entries in (data.get("devices") or {}).items():
        label = ios_runtime_label(runtime_id)
        if not label:
            continue
        for entry in entries or []:
            udid = str(entry.get("udid", ""))
            if not entry.get("isAvailable", True) or not UDID_RE.match(udid):
                continue
            state = _SIMCTL_STATES.get(entry.get("state", ""), "stopped")
            devices.append(MobileDevice(udid, IOS, str(entry.get("name") or udid), label, state))

    def sort_key(device: MobileDevice):
        version = tuple(int(p) for p in re.findall(r"\d+", device.os_version or ""))
        return (tuple(-v for v in version), device.name)

    return sorted(devices, key=sort_key)


async def xcode_info() -> dict:
    """Xcode location/version on the station (cached; changes rarely)."""
    cached_at = _xcode_cache.get("at")
    if isinstance(cached_at, float) and time.monotonic() - cached_at < _XCODE_INFO_TTL_SECONDS:
        return dict(_xcode_cache["value"])  # type: ignore[arg-type]
    info: dict = {"xcode_path": None, "xcode_version": None}
    try:
        code, out, _ = await _run(["xcode-select", "-p"], timeout=10)
        if code == 0 and out.strip():
            info["xcode_path"] = out.strip().removesuffix("/Contents/Developer")
        code, out, _ = await _run(["xcodebuild", "-version"], timeout=20)
        if code == 0 and out.strip():
            info["xcode_version"] = out.strip().splitlines()[0]
    except DeviceError:
        pass
    _xcode_cache.update({"value": info, "at": time.monotonic()})
    return dict(info)


async def list_ios() -> tuple[dict, list[MobileDevice]]:
    family = _os_family()
    if family != "macos":
        station_os = {"windows": "Windows", "linux": "Linux"}.get(family, "this operating system")
        reason = f"iOS simulators need macOS with Xcode (Apple limitation); this station runs {station_os}."
        return {"available": False, "reason": reason, "tooling": None}, []
    if not shutil.which("xcrun"):
        reason = "Xcode command line tools not found on this station."
        return {"available": False, "reason": reason, "tooling": None}, []
    tooling = await xcode_info()
    code, out, err = await _run(["xcrun", "simctl", "list", "devices", "available", "-j"])
    if code != 0:
        reason = f"xcrun simctl failed: {(err or out).strip()[:200]}"
        return {"available": False, "reason": reason, "tooling": tooling}, []
    devices = [_apply_pending(d) for d in parse_simctl_devices(out)]
    return {"available": True, "reason": None, "tooling": tooling}, devices


async def _boot_ios(device: MobileDevice) -> None:
    code, out, err = await _run(["xcrun", "simctl", "boot", device.id], timeout=60)
    if code != 0 and "current state: Booted" not in (err + out):
        raise DeviceError(f"simctl boot failed: {(err or out).strip()[:200]}", 502)
    # Best effort: bring up the Simulator window so the device is visible.
    try:
        await _run(["open", "-a", "Simulator", "--args", "-CurrentDeviceUDID", device.id], timeout=15)
    except DeviceError:
        pass


async def _stop_ios(device: MobileDevice) -> None:
    code, out, err = await _run(["xcrun", "simctl", "shutdown", device.id], timeout=60)
    if code != 0 and "current state: Shutdown" not in (err + out):
        raise DeviceError(f"simctl shutdown failed: {(err or out).strip()[:200]}", 502)


# ── Public API ───────────────────────────────────────────────────────────────

async def _safe_list(lister) -> tuple[dict, list[MobileDevice]]:
    try:
        return await lister()
    except DeviceError as exc:
        return {"available": False, "reason": exc.message, "tooling": None}, []


async def list_devices() -> dict:
    (android_status, android), (ios_status, ios) = await asyncio.gather(
        _safe_list(list_android), _safe_list(list_ios)
    )
    return {
        "station": station_info(),
        "platforms": {ANDROID: android_status, IOS: ios_status},
        "devices": [d.to_dict() for d in android + ios],
    }


async def _find_device(platform: str, device_id: str) -> MobileDevice:
    if platform == ANDROID:
        valid, lister = AVD_NAME_RE.match(device_id), list_android
    elif platform == IOS:
        valid, lister = UDID_RE.match(device_id), list_ios
    else:
        raise DeviceError(f"Unsupported platform: {platform}", 400)
    if not valid:
        raise DeviceError("Invalid device id", 400)
    status, devices = await lister()
    if not status["available"]:
        raise DeviceError(status["reason"], 503)
    for device in devices:
        if device.id == device_id:
            return device
    raise DeviceError("Device not found", 404)


async def boot_device(platform: str, device_id: str) -> dict:
    device = await _find_device(platform, device_id)
    if device.state in ("stopped", "stopping"):
        await (_boot_android(device) if platform == ANDROID else _boot_ios(device))
        _pending[(platform, device_id)] = ("running", time.monotonic())
    return await list_devices()


async def shutdown_device(platform: str, device_id: str) -> dict:
    device = await _find_device(platform, device_id)
    if device.state in ("running", "booting"):
        await (_stop_android(device) if platform == ANDROID else _stop_ios(device))
        _pending[(platform, device_id)] = ("stopped", time.monotonic())
    return await list_devices()
