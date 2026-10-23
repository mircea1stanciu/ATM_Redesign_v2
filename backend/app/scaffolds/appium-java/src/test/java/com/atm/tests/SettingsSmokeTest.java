package com.atm.tests;

import io.appium.java_client.android.AndroidDriver;
import org.testng.Assert;
import org.testng.annotations.AfterClass;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Needs a running Appium server and an Android device/emulator (see appium.properties). */
public class SettingsSmokeTest {
    private AndroidDriver driver;

    @BeforeClass
    public void startSession() throws Exception {
        driver = DriverFactory.createAndroidDriver();
    }

    @AfterClass(alwaysRun = true)
    public void endSession() {
        if (driver != null) {
            driver.quit();
        }
    }

    @Test
    public void appIsInForeground() {
        String expected = DriverFactory.config().getProperty("appPackage");
        Assert.assertEquals(driver.getCurrentPackage(), expected);
    }
}
