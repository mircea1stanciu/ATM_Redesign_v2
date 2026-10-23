from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def test_shows_the_form(driver):
    assert driver.title == "Web form"
    assert driver.find_element(By.TAG_NAME, "h1").text == "Web form"


def test_submits_the_form(driver):
    driver.find_element(By.ID, "my-text-id").send_keys("Hello from ATM")
    driver.find_element(By.CSS_SELECTOR, "button[type=submit]").click()
    WebDriverWait(driver, 10).until(EC.text_to_be_present_in_element((By.TAG_NAME, "h1"), "Form submitted"))
    assert driver.find_element(By.ID, "message").text == "Received!"
