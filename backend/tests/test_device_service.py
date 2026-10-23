import asyncio
import json

import pytest

from app.services import device_service
from app.services.device_service import (
    DeviceError,
    ios_runtime_label,
    parse_adb_devices,
    parse_avd_list,
    parse_emu_avd_name,
    parse_simctl_devices,
)


def test_parse_avd_list_ignores_log_lines():
    output = "INFO    | Storing crashdata in: /tmp/x\nPixel_10a\nPixel_10_Pro_XL\n\n"
    assert parse_avd_list(output) == ["Pixel_10a", "Pixel_10_Pro_XL"]


def test_parse_adb_devices_only_returns_emulators():
    output = (
        "List of devices attached\n"
        "emulator-5554\tdevice\n"
        "emulator-5556\toffline\n"
        "R58M123ABC\tdevice\n"
    )
    assert parse_adb_devices(output) == [("emulator-5554", "device"), ("emulator-5556", "offline")]


def test_parse_emu_avd_name_strips_console_ok():
    assert parse_emu_avd_name("Pixel_10_Pro_XL\r\nOK\r\n") == "Pixel_10_Pro_XL"
    assert parse_emu_avd_name("OK\r\n") is None


def test_ios_runtime_label():
    assert ios_runtime_label("com.apple.CoreSimulator.SimRuntime.iOS-26-5") == "iOS 26.5"
    assert ios_runtime_label("com.apple.CoreSimulator.SimRuntime.iOS-27-0") == "iOS 27.0"
    assert ios_runtime_label("com.apple.CoreSimulator.SimRuntime.watchOS-11-0") is None


def test_parse_simctl_devices_maps_state_and_filters():
    payload = json.dumps({
        "devices": {
            "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
                {"udid": "DDBD3F8D-8446-41A4-8549-471343FF5484", "name": "iPhone 17 Pro",
                 "state": "Shutdown", "isAvailable": True},
                {"udid": "not-a-udid", "name": "Broken", "state": "Booted", "isAvailable": True},
            ],
            "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
                {"udid": "51C8DCCB-ACA1-4D2C-97CB-4317F9F27D56", "name": "iPhone 18 Pro",
                 "state": "Booted", "isAvailable": True},
                {"udid": "11111111-2222-3333-4444-555555555555", "name": "Unavailable",
                 "state": "Shutdown", "isAvailable": False},
            ],
            "com.apple.CoreSimulator.SimRuntime.watchOS-11-0": [
                {"udid": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", "name": "Watch",
                 "state": "Shutdown", "isAvailable": True},
            ],
        }
    })
    devices = parse_simctl_devices(payload)
    assert [(d.name, d.os_version, d.state) for d in devices] == [
        ("iPhone 18 Pro", "iOS 27.0", "running"),
        ("iPhone 17 Pro", "iOS 26.5", "stopped"),
    ]


@pytest.mark.parametrize(
    "platform,device_id",
    [
        ("android", "Pixel; rm -rf /"),
        ("android", "../../etc/passwd"),
        ("ios", "booted"),
        ("ios", "51C8DCCB-ACA1-4D2C-97CB-4317F9F27D56 --erase"),
        ("windows", "anything"),
    ],
)
def test_actions_reject_invalid_ids_before_running_commands(monkeypatch, platform, device_id):
    async def fail_if_called(*args, **kwargs):
        raise AssertionError("no command should run for an invalid id")

    monkeypatch.setattr(device_service, "_run", fail_if_called)
    with pytest.raises(DeviceError) as exc:
        asyncio.run(device_service.boot_device(platform, device_id))
    assert exc.value.status_code == 400


def _make_sdk(root, exe_suffix=""):
    for folder, name in (("emulator", "emulator"), ("platform-tools", "adb")):
        path = root / folder / f"{name}{exe_suffix}"
        path.parent.mkdir(parents=True)
        path.write_text("")
        path.chmod(0o755)


def _isolate_sdk_lookup(monkeypatch, tmp_path):
    monkeypatch.setattr(device_service.settings, "ANDROID_SDK_ROOT", "")
    for var in ("ANDROID_SDK_ROOT", "ANDROID_HOME", "LOCALAPPDATA"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(device_service.Path, "home", classmethod(lambda cls: tmp_path / "home"))
    monkeypatch.setattr(device_service.shutil, "which", lambda name: None)


def test_windows_station_finds_sdk_in_localappdata(monkeypatch, tmp_path):
    _isolate_sdk_lookup(monkeypatch, tmp_path)
    monkeypatch.setattr(device_service, "IS_WINDOWS", True)
    sdk = tmp_path / "AppData" / "Local" / "Android" / "Sdk"
    _make_sdk(sdk, ".exe")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "AppData" / "Local"))

    tooling = device_service.android_tooling()

    assert tooling.sdk_path == str(sdk)
    assert tooling.source == "Android Studio default location"
    assert tooling.emulator.endswith("emulator.exe")
    assert tooling.adb.endswith("adb.exe")


def test_windows_station_ignores_non_exe_tools(monkeypatch, tmp_path):
    _isolate_sdk_lookup(monkeypatch, tmp_path)
    monkeypatch.setattr(device_service, "IS_WINDOWS", True)
    _make_sdk(tmp_path / "sdk")
    monkeypatch.setenv("ANDROID_HOME", str(tmp_path / "sdk"))

    assert device_service.android_tooling().emulator is None


def test_android_sdk_root_env_takes_priority(monkeypatch, tmp_path):
    _isolate_sdk_lookup(monkeypatch, tmp_path)
    monkeypatch.setattr(device_service, "IS_WINDOWS", False)
    _make_sdk(tmp_path / "custom-sdk")
    _make_sdk(tmp_path / "home" / "Library" / "Android" / "sdk")
    monkeypatch.setenv("ANDROID_SDK_ROOT", str(tmp_path / "custom-sdk"))

    tooling = device_service.android_tooling()

    assert tooling.sdk_path == str(tmp_path / "custom-sdk")
    assert tooling.source == "ANDROID_SDK_ROOT"


def test_missing_sdk_reports_station_specific_reason(monkeypatch, tmp_path):
    _isolate_sdk_lookup(monkeypatch, tmp_path)
    monkeypatch.setattr(device_service, "IS_WINDOWS", True)

    status, devices = asyncio.run(device_service.list_android())

    assert devices == []
    assert status["available"] is False
    assert r"%LOCALAPPDATA%\Android\Sdk" in status["reason"]


def test_windows_boot_detaches_with_creation_flags(monkeypatch, tmp_path):
    monkeypatch.setattr(device_service, "IS_WINDOWS", True)
    monkeypatch.setattr(device_service, "_android_tools", lambda: ("C:/sdk/emulator/emulator.exe", "adb.exe"))
    monkeypatch.setattr(device_service.settings, "ARTIFACTS_DIR", str(tmp_path))
    calls = []
    monkeypatch.setattr(device_service.subprocess, "Popen", lambda cmd, **kw: calls.append((cmd, kw)))

    device = device_service.MobileDevice("Pixel_10a", "android", "Pixel 10a", None, "stopped")
    asyncio.run(device_service._boot_android(device))

    cmd, kwargs = calls[0]
    assert cmd == ["C:/sdk/emulator/emulator.exe", "-avd", "Pixel_10a"]
    assert kwargs["creationflags"] == device_service._DETACHED_FLAGS
    assert "start_new_session" not in kwargs


def test_ios_unavailable_on_windows_station(monkeypatch):
    monkeypatch.setattr(device_service, "_os_family", lambda: "windows")

    status, devices = asyncio.run(device_service.list_ios())

    assert devices == []
    assert status["available"] is False
    assert "Windows" in status["reason"]


def test_station_info_has_identity_fields():
    info = device_service.station_info()
    assert info["hostname"]
    assert info["os"]
    assert info["os_family"] in {"macos", "windows", "linux", "other"}
