def test_app_is_in_foreground(driver, appium_config):
    assert driver.current_package == appium_config["app_package"]
