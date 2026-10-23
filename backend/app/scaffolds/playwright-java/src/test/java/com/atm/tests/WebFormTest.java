package com.atm.tests;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.options.AriaRole;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;

class WebFormTest {
    private static final String BASE_URL = System.getProperty("baseUrl", "https://www.selenium.dev/selenium/web/");

    private static Playwright playwright;
    private static Browser browser;
    private BrowserContext context;
    private Page page;

    @BeforeAll
    static void launchBrowser() {
        playwright = Playwright.create();
        boolean headless = !Boolean.getBoolean("headed");
        // Installed browser to use: chrome (default), msedge, chrome-beta, ...
        String channel = System.getProperty("browser.channel", "chrome");
        browser = playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(headless).setChannel(channel));
    }

    @AfterAll
    static void closeBrowser() {
        if (playwright != null) {
            playwright.close();
        }
    }

    @BeforeEach
    void openForm() {
        context = browser.newContext();
        page = context.newPage();
        page.navigate(BASE_URL + "web-form.html");
    }

    @AfterEach
    void closeContext() {
        context.close();
    }

    @Test
    void showsTheForm() {
        assertThat(page).hasTitle("Web form");
        assertThat(page.getByRole(AriaRole.HEADING, new Page.GetByRoleOptions().setLevel(1))).hasText("Web form");
    }

    @Test
    void submitsTheForm() {
        page.locator("#my-text-id").fill("Hello from ATM");
        page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Submit")).click();
        assertThat(page.getByRole(AriaRole.HEADING, new Page.GetByRoleOptions().setLevel(1))).hasText("Form submitted");
        assertThat(page.locator("#message")).hasText("Received!");
    }
}
