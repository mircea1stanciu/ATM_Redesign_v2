import configparser
from pathlib import Path

import pytest
from appium import webdriver
from appium.options.android import UiAutomator2Options

CONFIG_FILE = Path(__file__).resolve().parent.parent / "appium.ini"


@pytest.fixture(scope="session")
def appium_config() -> configparser.SectionProxy:
    parser = configparser.ConfigParser()
    parser.read(CONFIG_FILE)
    return parser["appium"]


@pytest.fixture
def driver(appium_config):
    """Needs a running Appium server and an Android device/emulator (see appium.ini)."""
    options = UiAutomator2Options()
    options.platform_name = appium_config["platform_name"]
    options.automation_name = appium_config["automation_name"]
    options.device_name = appium_config["device_name"]
    if appium_config.get("app"):
        options.app = appium_config["app"]
    else:
        options.app_package = appium_config["app_package"]
        options.app_activity = appium_config["app_activity"]
    session = webdriver.Remote(appium_config["url"], options=options)
    yield session
    session.quit()
