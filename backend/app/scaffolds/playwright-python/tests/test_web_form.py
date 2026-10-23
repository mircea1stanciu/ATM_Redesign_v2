import pytest
from playwright.sync_api import Page, expect


@pytest.fixture(autouse=True)
def open_form(page: Page):
    page.goto("web-form.html")


def test_shows_the_form(page: Page):
    expect(page).to_have_title("Web form")
    expect(page.get_by_role("heading", level=1)).to_have_text("Web form")


def test_submits_the_form(page: Page):
    page.locator("#my-text-id").fill("Hello from ATM")
    page.get_by_role("button", name="Submit").click()
    expect(page.get_by_role("heading", level=1)).to_have_text("Form submitted")
    expect(page.locator("#message")).to_have_text("Received!")
