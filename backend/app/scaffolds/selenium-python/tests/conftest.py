import os

import pytest
from selenium import webdriver

BASE_URL = os.environ.get("BASE_URL", "https://www.selenium.dev/selenium/web/")


@pytest.fixture
def driver():
    options = webdriver.ChromeOptions()
    if os.environ.get("HEADED") != "1":
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1080")
    # Selenium Manager downloads a matching chromedriver automatically.
    browser = webdriver.Chrome(options=options)
    browser.get(BASE_URL + "web-form.html")
    yield browser
    browser.quit()
