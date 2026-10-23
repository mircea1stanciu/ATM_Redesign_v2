package com.atm.tests;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WebFormTest {
    private static final String BASE_URL = System.getProperty("baseUrl", "https://www.selenium.dev/selenium/web/");
    private WebDriver driver;

    @BeforeEach
    void openForm() {
        ChromeOptions options = new ChromeOptions();
        if (!Boolean.getBoolean("headed")) {
            options.addArguments("--headless=new", "--window-size=1920,1080");
        }
        // Selenium Manager downloads a matching chromedriver automatically.
        driver = new ChromeDriver(options);
        driver.get(BASE_URL + "web-form.html");
    }

    @AfterEach
    void stopBrowser() {
        if (driver != null) {
            driver.quit();
        }
    }

    @Test
    void showsTheForm() {
        assertEquals("Web form", driver.getTitle());
        assertEquals("Web form", driver.findElement(By.tagName("h1")).getText());
    }

    @Test
    void submitsTheForm() {
        driver.findElement(By.id("my-text-id")).sendKeys("Hello from ATM");
        driver.findElement(By.cssSelector("button[type=submit]")).click();
        new WebDriverWait(driver, Duration.ofSeconds(10))
                .until(ExpectedConditions.textToBe(By.tagName("h1"), "Form submitted"));
        assertEquals("Received!", driver.findElement(By.id("message")).getText());
    }
}
