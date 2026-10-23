import asyncio

from app.services import appium_project_service as svc
from app.services.appium_project_service import (
    DeviceProfile,
    android_version_for_api,
    discover_runners,
    discover_suites,
    parse_device_profiles,
    parse_pom,
    parse_properties,
    parse_runner,
)

SET_PROPS = '''
    private static void setDeviceProps() {
        String derivedDataPathRoot = System.getProperty("user.dir") + "/x/";
        switch (deviceRunOption) {
            case "a999":
                System.setProperty("deviceUDID", "emulator-5554"); //  Emulator
                System.setProperty("deviceName", "Pixel_9");
                System.setProperty("avd", "Pixel_9");
                System.setProperty("platformVersion", "15");
                System.setProperty("systemPort", String.valueOf(9173));
                break;
            case "a999anca":
            case "a999bianca":
                System.setProperty("deviceUDID", "emulator-5554");
                System.setProperty("avd", "Pixel_3a_API_30");
                System.setProperty("platformVersion", "11");
                break;
            case "i15":
                System.setProperty("deviceUDID", "D6531572-F8C8-46B6-AB28-D8D0E32AFA46");
                System.setProperty("deviceName", "i15");
                System.setProperty("platformVersion", "18.3");
                System.setProperty("derivedDataPathVar", derivedDataPathRoot);
                System.setProperty("wdaLocalPort", String.valueOf(8205));
                break;
            case "be":
                System.setProperty("deviceName", "BackEnd");
                break;
            default:
                fail();
        }
    }
'''

RUNNER = '''
package com.athena.appium.runners.sanityRunners.sanityPayments;

@CucumberOptions(
        features = "src/test/resources/features/paymentsFeatures",
        glue = {"com.athena"},
        tags = "@SanityPaymentsOwn and @RO"
)
public class SanityPaymentsOwnRunner extends AbstractTestNGCucumberTestsCustom {
}
'''

IOS_UDID = "51C8DCCB-ACA1-4D2C-97CB-4317F9F27D56"


def _station(devices, android=True, ios=True):
    return {
        "station": {"hostname": "h", "os": "macOS", "os_family": "macos", "user": "u"},
        "platforms": {
            "android": {"available": android, "reason": None if android else "no sdk"},
            "ios": {"available": ios, "reason": None if ios else "no xcode"},
        },
        "devices": devices,
    }


def test_parse_device_profiles_groups_aliases_and_literals():
    profiles = parse_device_profiles(SET_PROPS, "SetProps.java")
    by_option = {p.option: p for p in profiles}

    assert list(by_option) == ["a999", "a999anca", "i15"]
    assert by_option["a999"].avd == "Pixel_9"
    assert by_option["a999"].port == "9173"
    assert by_option["a999anca"].aliases == ["a999bianca"]
    assert by_option["i15"].platform == "ios"
    assert by_option["i15"].udid == "D6531572-F8C8-46B6-AB28-D8D0E32AFA46"
    assert by_option["i15"].port == "8205"
    assert by_option["i15"].line == SET_PROPS.splitlines().index('            case "i15":') + 1


def test_parse_runner_and_skip_abstract():
    runner = parse_runner(RUNNER)
    assert runner["name"] == "SanityPaymentsOwnRunner"
    assert runner["class_name"].endswith("sanityPayments.SanityPaymentsOwnRunner")
    assert runner["features"] == "src/test/resources/features/paymentsFeatures"
    assert runner["tags"] == "@SanityPaymentsOwn and @RO"
    assert parse_runner(RUNNER.replace("public class", "public abstract class")) is None
    assert parse_runner("public class Plain {}") is None


def test_discover_runners_flags_missing_features(tmp_path):
    java = tmp_path / "src/test/java/com/x/runners/sanity"
    java.mkdir(parents=True)
    (java / "OkRunner.java").write_text(RUNNER.replace("SanityPaymentsOwnRunner", "OkRunner"))
    (java / "BrokenRunner.java").write_text(
        RUNNER.replace("SanityPaymentsOwnRunner", "BrokenRunner").replace("paymentsFeatures", "missing")
    )
    (tmp_path / "src/test/resources/features/paymentsFeatures").mkdir(parents=True)

    runners = {r["name"]: r for r in discover_runners(tmp_path, list((tmp_path / "src").rglob("*.java")))}

    assert runners["OkRunner"]["runnable"] is True
    assert runners["BrokenRunner"]["runnable"] is False
    assert "missing" in runners["BrokenRunner"]["issue"]


def test_discover_suites_only_testng_suites(tmp_path):
    folder = tmp_path / "src/test/resources/sanityChecksPi"
    folder.mkdir(parents=True)
    (folder / "SanityPayments.xml").write_text(
        '<suite name="SanityPayments"><test name="t"><classes>'
        '<class name="com.x.SanityPaymentsRunner"/></classes></test></suite>'
    )
    (tmp_path / "src/test/resources/log").mkdir()
    (tmp_path / "src/test/resources/log/log4j2.xml").write_text("<Configuration/>")

    suites = discover_suites(tmp_path)

    assert [(s["folder"], s["file"], s["classes"]) for s in suites] == [
        ("sanityChecksPi", "SanityPayments.xml", ["com.x.SanityPaymentsRunner"])
    ]


def test_parse_pom_and_properties():
    pom = parse_pom("<properties><java.version>25</java.version><java-client.version>10.1.1</java-client.version>"
                    "</properties><profile><id>XMLSuite</id></profile>")
    assert pom == {"java_release": 25, "appium_client_version": "10.1.1", "has_xml_suite_profile": True}
    props = parse_properties("# comment\nappEnv = pre\ndeviceRunOption=i15\n\nreportReleaseTag =\n")
    assert props == {"appEnv": "pre", "deviceRunOption": "i15", "reportReleaseTag": ""}


def test_android_version_for_api():
    assert android_version_for_api("Android API 36.1") == "16"
    assert android_version_for_api("Android API 35") == "15"
    assert android_version_for_api("Android API 30") == "11"
    assert android_version_for_api(None) is None


def _ios_profile(udid="D6531572-F8C8-46B6-AB28-D8D0E32AFA46", version="18.3"):
    return DeviceProfile("i15", [], "ios", "i15", udid, None, version, "8205", "SetProps.java", 10)


def test_ios_profile_missing_simulator_is_error(monkeypatch):
    station = _station([{"id": IOS_UDID, "platform": "ios", "name": "iPhone 18 Pro", "os_version": "iOS 27.0",
                         "state": "running", "serial": None}])
    profile = asyncio.run(svc.match_profile(_ios_profile(), station, {"ios": set(), "android": set()}))
    assert profile.status == "error"
    assert "not installed on this station" in profile.issues[0]


def test_ios_profile_version_and_app_checks(monkeypatch):
    monkeypatch.setattr(svc, "ios_app_installed", lambda udid, ids: False)
    station = _station([{"id": IOS_UDID, "platform": "ios", "name": "iPhone 18 Pro", "os_version": "iOS 27.0",
                         "state": "running", "serial": None}])
    profile = asyncio.run(svc.match_profile(_ios_profile(IOS_UDID), station, {"ios": {"b.id"}, "android": set()}))
    assert profile.status == "error"
    assert any("platformVersion 18.3" in issue for issue in profile.issues)
    assert any("not installed on this simulator" in issue for issue in profile.issues)


def test_android_profile_serial_mismatch_and_app_installed(monkeypatch):
    async def installed(serial, packages):
        return True

    monkeypatch.setattr(svc, "android_app_installed", installed)
    station = _station([{"id": "Pixel_9", "platform": "android", "name": "Pixel 9", "os_version": "Android API 35",
                         "state": "running", "serial": "emulator-5556"}])
    profile = DeviceProfile("a999", [], "android", "Pixel_9", "emulator-5554", "Pixel_9", "15", "9173", "f", 1)

    result = asyncio.run(svc.match_profile(profile, station, {"ios": set(), "android": {"ro.app"}}))

    assert result.status == "error"
    assert result.issues == ["deviceUDID is emulator-5554 but the emulator runs as emulator-5556."]
    assert result.app_installed is True


def test_android_profile_ready(monkeypatch):
    async def installed(serial, packages):
        return True

    monkeypatch.setattr(svc, "android_app_installed", installed)
    station = _station([{"id": "Pixel_9", "platform": "android", "name": "Pixel 9", "os_version": "Android API 35",
                         "state": "running", "serial": "emulator-5554"}])
    profile = DeviceProfile("a999", [], "android", "Pixel_9", "emulator-5554", "Pixel_9", "15", "9173", "f", 1)

    assert asyncio.run(svc.match_profile(profile, station, {"ios": set(), "android": {"ro.app"}})).status == "ok"


def test_platform_unavailable_on_station():
    station = _station([], ios=False)
    profile = asyncio.run(svc.match_profile(_ios_profile(), station, {"ios": set(), "android": set()}))
    assert profile.status == "error"
    assert profile.issues == ["no xcode"]


def test_suggest_profile_edit_prefers_device_with_app(monkeypatch):
    other = "79C55B09-AEEA-47D4-957D-6D165EB76043"
    monkeypatch.setattr(svc, "ios_app_installed", lambda udid, ids: udid == IOS_UDID)
    station = _station([
        {"id": other, "platform": "ios", "name": "iPhone 17", "os_version": "iOS 26.5", "state": "running",
         "serial": None},
        {"id": IOS_UDID, "platform": "ios", "name": "iPhone 18 Pro", "os_version": "iOS 27.0", "state": "stopped",
         "serial": None},
    ])

    suggestion = svc.suggest_profile_edit(
        _ios_profile(), svc.best_station_device("ios", station, {"ios": {"b.id"}, "android": set()})
    )

    assert suggestion["device"]["id"] == IOS_UDID
    assert suggestion["changes"] == [
        {"key": "deviceUDID", "current": "D6531572-F8C8-46B6-AB28-D8D0E32AFA46", "suggested": IOS_UDID},
        {"key": "platformVersion", "current": "18.3", "suggested": "27.0"},
    ]


def test_java_check_ignores_java_home_fallback_to_older_jdk(monkeypatch, tmp_path):
    old_jdk = tmp_path / "jdk21"
    old_jdk.mkdir()
    (old_jdk / "release").write_text('JAVA_VERSION="21.0.11"\n')

    async def fake_run(cmd, timeout=20):
        if cmd[-1] == "-version":
            return 0, "", 'openjdk version "21.0.11" 2026-04-21\n'
        return 0, f"{old_jdk}\n", ""

    monkeypatch.setattr(svc, "run_command", fake_run)
    monkeypatch.setattr(svc.shutil, "which", lambda name: "/usr/bin/java")
    monkeypatch.setattr(svc.device_service, "_os_family", lambda: "macos")
    monkeypatch.setattr(svc.Path, "exists", lambda self: True)
    monkeypatch.delenv("JAVA_HOME", raising=False)

    check = asyncio.run(svc._check_java(25))

    assert check.status == "error"
    assert "Install JDK 25" in check.fix


# ── Running ──────────────────────────────────────────────────────────────────

import os  # noqa: E402
import time  # noqa: E402

import pytest  # noqa: E402

APP_ENV = '''
public enum AppEnv {
    TEST("test"),
    PRE("pre");
}
'''


def _make_repo(tmp_path):
    (tmp_path / "pom.xml").write_text(
        "<project><properties><java.version>25</java.version></properties>"
        "<dependency><groupId>io.appium</groupId></dependency><profile><id>XMLSuite</id></profile></project>"
    )
    java = tmp_path / "src/test/java/com/x"
    (java / "runners").mkdir(parents=True)
    (java / "runners/SanityPaymentsOwnRunner.java").write_text(RUNNER)
    (java / "AppEnv.java").write_text(APP_ENV)
    (java / "SetProps.java").write_text(SET_PROPS)
    (tmp_path / "src/test/resources/features/paymentsFeatures").mkdir(parents=True)
    suites = tmp_path / "src/test/resources/sanityChecksPi"
    suites.mkdir()
    (suites / "SanityPayments.xml").write_text('<suite name="SanityPayments"><test name="t"/></suite>')
    return tmp_path


@pytest.fixture
def station_tools(monkeypatch):
    async def java(required):
        return 21, "/jdk25"

    monkeypatch.setattr(svc, "find_java", java)
    monkeypatch.setattr(svc, "_maven_command", lambda repo: "/usr/bin/mvn")


def test_build_run_plan_for_runner_uses_newer_jdk(tmp_path, station_tools):
    repo = _make_repo(tmp_path)

    plan = asyncio.run(svc.build_run_plan(repo, "runner:SanityPaymentsOwnRunner", "pre", "i15"))

    assert plan.argv == ["/usr/bin/mvn", "-B", "-Dstyle.color=never", "test", "-Dtest=SanityPaymentsOwnRunner",
                         "-DappEnv=pre", "-DdeviceRunOption=i15"]
    assert plan.target == "runner:SanityPaymentsOwnRunner"
    assert plan.java_home == "/jdk25"
    assert plan.env["JAVA_HOME"] == "/jdk25"
    assert plan.env["PATH"].startswith(os.path.join("/jdk25", "bin"))


def test_build_run_plan_for_suite_and_alias_profile(tmp_path, station_tools):
    repo = _make_repo(tmp_path)

    plan = asyncio.run(svc.build_run_plan(repo, "suite:sanityChecksPi/SanityPayments.xml", "test", "a999bianca"))

    assert plan.argv[4:7] == ["-PXMLSuite", "-DtestTypePackage=sanityChecksPi", "-DsuiteXmlFile=SanityPayments.xml"]
    assert plan.label == "SanityPayments (sanityChecksPi)"


@pytest.mark.parametrize(
    "target,app_env,device,message",
    [
        ("runner:Nope", "pre", "i15", "not found"),
        ("runner:SanityPaymentsOwnRunner -Dmaven.test.skip=true", "pre", "i15", "not found"),
        ("suite:../../etc/SanityPayments.xml", "pre", "i15", "not found"),
        ("suite:sanityChecksPi/Missing.xml", "pre", "i15", "not found"),
        ("runner:SanityPaymentsOwnRunner", "prod", "i15", "Invalid appEnv"),
        ("runner:SanityPaymentsOwnRunner", "pre -X", "i15", "Invalid appEnv"),
        ("runner:SanityPaymentsOwnRunner", "pre", "i99", "not defined"),
        ("runner:SanityPaymentsOwnRunner", "pre", "i15;rm", "not defined"),
        ("collection:x", "pre", "i15", "Select a Cucumber runner"),
    ],
)
def test_build_run_plan_rejects_invalid_requests(tmp_path, station_tools, target, app_env, device, message):
    repo = _make_repo(tmp_path)
    with pytest.raises(ValueError, match=message):
        asyncio.run(svc.build_run_plan(repo, target, app_env, device))


def test_build_run_plan_warns_when_no_suitable_jdk(tmp_path, monkeypatch):
    async def java(required):
        return 21, None

    monkeypatch.setattr(svc, "find_java", java)
    monkeypatch.setattr(svc, "_maven_command", lambda repo: "mvn")

    plan = asyncio.run(svc.build_run_plan(_make_repo(tmp_path), "runner:SanityPaymentsOwnRunner", "pre", "i15"))

    assert plan.java_home is None
    assert "Install JDK 25" in plan.warnings[0]


def _junit(name, failures=0):
    case = '<testcase name="{0}" classname="C" time="1.0">{1}</testcase>'
    body = case.format(name, '<failure message="boom">trace</failure>' if failures else "")
    return f'<testsuite name="S" tests="1" failures="{failures}" errors="0" skipped="0">{body}</testsuite>'


def test_collect_surefire_results_ignores_stale_reports(tmp_path):
    reports = tmp_path / "target/surefire-reports"
    reports.mkdir(parents=True)
    stale = reports / "TEST-Old.xml"
    stale.write_text(_junit("old scenario"))
    os.utime(stale, (time.time() - 3600, time.time() - 3600))
    since = time.time() - 5
    (reports / "TEST-A.xml").write_text(_junit("scenario A"))
    (reports / "TEST-B.xml").write_text(_junit("scenario B", failures=1))

    results = svc.collect_surefire_results(tmp_path, since)

    assert sorted(r["test_name"] for r in results["test_results"]) == ["scenario A", "scenario B"]
    assert (results["total_tests"], results["passed_tests"], results["failed_tests"]) == (2, 1, 1)


def test_collect_surefire_results_none_when_no_new_reports(tmp_path):
    assert svc.collect_surefire_results(tmp_path, time.time()) is None


def test_copy_new_allure_results_only_copies_this_run(tmp_path):
    source = tmp_path / "target/allure-results"
    source.mkdir(parents=True)
    old = source / "old-result.json"
    old.write_text("{}")
    os.utime(old, (time.time() - 3600, time.time() - 3600))
    since = time.time() - 5
    (source / "new-result.json").write_text("{}")
    target = tmp_path / "artifacts/allure-results"

    assert svc.copy_new_allure_results(tmp_path, since, target) == 1
    assert [p.name for p in target.iterdir()] == ["new-result.json"]


# ── Runner feature resolution ────────────────────────────────────────────────

CONSTANT_RUNNER = '''
package com.x.runners.multiBankingRunners;

@CucumberOptions(features = MultiBankingRunnerBase.MULTI_BANKING_FEATURES, glue = {"com.athena"})
public class LightMultiBankingINGBankRunner extends MultiBankingRunnerBase {
    @Override
    protected String baseTagExpression() {
        return "(@Nav or @ConnectING"
                + " or @ConsentING)";
    }
}
'''

BASE = '''
public abstract class MultiBankingRunnerBase {
    public static final String MULTI_BANKING_FEATURES = "src/test/resources/features/consumptionMultiBankingFeatures";
}
'''

RERUN_RUNNER = '''
package com.x.runners.custom;
@CucumberOptions(
        glue = {"com.athena"}
)
public class FailedScenariosRunner extends AbstractTestNGCucumberTestsCustom {}
'''


def _write_runner_repo(tmp_path, runners: dict[str, str]):
    java = tmp_path / "src/test/java/com/x"
    java.mkdir(parents=True)
    (java / "MultiBankingRunnerBase.java").write_text(BASE)
    for name, text in runners.items():
        (java / f"{name}.java").write_text(text)
    features = tmp_path / "src/test/resources/features"
    (features / "consumptionMultiBankingFeatures").mkdir(parents=True)
    (features / "AccountStatement.feature").write_text("Feature: x")
    (features / "bau").mkdir()
    (features / "bau/BauCalculatorStepTitle.feature").write_text("Feature: x")
    return list((tmp_path / "src").rglob("*.java"))


def test_runner_features_from_constant_and_tags_from_code(tmp_path):
    files = _write_runner_repo(tmp_path, {"LightMultiBankingINGBankRunner": CONSTANT_RUNNER})
    runner = discover_runners(tmp_path, files)[0]
    assert runner["runnable"] is True
    assert runner["features"] == "src/test/resources/features/consumptionMultiBankingFeatures"
    assert runner["tags"] == "(@Nav or @ConnectING or @ConsentING)"


def test_runner_without_features_is_runtime_selected(tmp_path):
    files = _write_runner_repo(tmp_path, {"FailedScenariosRunner": RERUN_RUNNER})
    runner = discover_runners(tmp_path, files)[0]
    assert runner["runnable"] is True
    assert "runtime" in runner["note"]


def test_unresolved_constant_is_reported(tmp_path):
    files = _write_runner_repo(tmp_path, {"XRunner": CONSTANT_RUNNER.replace("MULTI_BANKING_FEATURES", "UNKNOWN")
                                          .replace("LightMultiBankingINGBankRunner", "XRunner")})
    runner = discover_runners(tmp_path, files)[0]
    assert runner["runnable"] is False
    assert "UNKNOWN" in runner["issue"]


def test_missing_paths_get_suggestions(tmp_path):
    moved = RUNNER.replace("src/test/resources/features/paymentsFeatures", "src/test/resources/features/piFeatures")
    renamed = RUNNER.replace("SanityPaymentsOwnRunner", "CalculatorTitlesRunner").replace(
        "src/test/resources/features/paymentsFeatures", "src/test/resources/features/bau/BauCalculatorTitle.feature")
    files = _write_runner_repo(tmp_path, {"SanityPaymentsOwnRunner": moved, "CalculatorTitlesRunner": renamed})
    runners = {r["name"]: r for r in discover_runners(tmp_path, files)}

    assert runners["SanityPaymentsOwnRunner"]["runnable"] is False
    assert runners["SanityPaymentsOwnRunner"]["suggested_features"] == "src/test/resources/features"
    assert runners["CalculatorTitlesRunner"]["suggested_features"] == (
        "src/test/resources/features/bau/BauCalculatorStepTitle.feature"
    )


# ── Run details ──────────────────────────────────────────────────────────────

import plistlib  # noqa: E402

RUN_LOG = """
\x1b[34m🖥️ Appium npm server version: 3.7.0\x1b[0m
Capabilities {appium:automationName: XCuiTest, appium:deviceName: i20, appium:platformVersion: 27.0, \
appium:udid: 51C8DCCB-ACA1-4D2C-97CB-4317F9F27D56, platformName: IOS}
📱 Version and number: SmartMobile_IOS-4.12.0-1234
"""


def test_parse_run_log_extracts_versions_and_capabilities():
    info = svc.parse_run_log(RUN_LOG)
    assert info["appium_server"] == "3.7.0"
    assert info["capabilities"] == {
        "platformName": "IOS", "platformVersion": "27.0", "deviceName": "i20",
        "udid": "51C8DCCB-ACA1-4D2C-97CB-4317F9F27D56", "automationName": "XCuiTest",
    }
    assert info["app"]["version"] == "4.12.0"
    assert info["app"]["build"] == "1234"


def test_ios_app_version_reads_installed_bundle(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_ios_device_data_dir", lambda udid: tmp_path / udid / "data")
    bundle = tmp_path / IOS_UDID / "data/Containers/Bundle/Application/ABC/SmartMobile 6.app"
    bundle.mkdir(parents=True)
    with open(bundle / "Info.plist", "wb") as handle:
        plistlib.dump({"CFBundleIdentifier": "ro.app", "CFBundleShortVersionString": "4.12.0",
                       "CFBundleVersion": "1234", "CFBundleDisplayName": "SmartMobile"}, handle)

    app = svc.ios_app_version(IOS_UDID, {"ro.app"})

    assert app == {"name": "SmartMobile", "id": "ro.app", "version": "4.12.0", "build": "1234",
                   "source": "simulator app bundle"}
    assert svc.ios_app_version(IOS_UDID, {"other.app"}) is None


def test_find_generated_reports_only_this_runs_reports(tmp_path):
    since = time.time() - 5
    reports = tmp_path / "TestReport"
    (reports / "i20").mkdir(parents=True)
    (reports / "a999mircea").mkdir()
    (reports / "cucumberStandardReports/i20").mkdir(parents=True)
    mine = reports / "i20/Automation-Test-Report-Cucumber-2026_i20.html"
    mine.write_text("<html/>")
    (reports / "cucumberStandardReports/i20/Automation-Test-Report-Cucumber-2026_i20.json").write_text("{}")
    (reports / "a999mircea/Automation-Test-Report-Cucumber-2026_a999mircea.html").write_text("<html/>")
    old = reports / "i20/Automation-Test-Report-Old_i20.html"
    old.write_text("<html/>")
    os.utime(old, (since - 3600, since - 3600))
    (tmp_path / "src").mkdir()
    (tmp_path / "src/data.json").write_text("{}")

    found = svc.find_generated_reports(tmp_path, since, time.time() + 5, "i20", ["i20", "a999mircea", "i15"])

    assert [p.relative_to(tmp_path).as_posix() for p in found] == [
        "TestReport/i20/Automation-Test-Report-Cucumber-2026_i20.html",
        "TestReport/cucumberStandardReports/i20/Automation-Test-Report-Cucumber-2026_i20.json",
    ]


def test_store_reports_copies_into_artifacts(tmp_path):
    source = tmp_path / "TestReport/r_i20.html"
    source.parent.mkdir()
    source.write_text("<html>report</html>")

    stored = svc.store_reports(tmp_path, [source], tmp_path / "artifacts/reports")

    assert stored == [{"name": "r_i20.html", "source": "TestReport/r_i20.html", "file": "00-r_i20.html",
                       "kind": "html", "size": len("<html>report</html>")}]
    assert (tmp_path / "artifacts/reports/00-r_i20.html").read_text() == "<html>report</html>"


def test_find_android_device_matches_id_or_display_name():
    devices = [
        {"id": "Pixel_10_Pro_XL", "platform": "android", "name": "Pixel 10 Pro XL"},
        {"id": "Pixel_10a", "platform": "android", "name": "Pixel 10a"},
    ]
    assert svc.find_android_device(devices, "Pixel 10a")["id"] == "Pixel_10a"
    assert svc.find_android_device(devices, "Pixel_10_Pro_XL")["id"] == "Pixel_10_Pro_XL"
    assert svc.find_android_device(devices, "Pixel_9") is None
