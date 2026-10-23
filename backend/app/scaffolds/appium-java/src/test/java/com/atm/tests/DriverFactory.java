package com.atm.tests;

import io.appium.java_client.android.AndroidDriver;
import io.appium.java_client.android.options.UiAutomator2Options;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.time.Duration;
import java.util.Properties;

/** Builds an Appium driver from src/test/resources/appium.properties (overridable with -Dkey=value). */
public final class DriverFactory {
    private DriverFactory() {
    }

    public static Properties config() {
        Properties props = new Properties();
        try (InputStream in = DriverFactory.class.getResourceAsStream("/appium.properties")) {
            if (in != null) {
                props.load(in);
            }
        } catch (IOException e) {
            throw new IllegalStateException("Could not read appium.properties", e);
        }
        props.putAll(System.getProperties());
        return props;
    }

    public static AndroidDriver createAndroidDriver() throws Exception {
        Properties cfg = config();
        UiAutomator2Options options = new UiAutomator2Options()
                .setDeviceName(cfg.getProperty("deviceName"))
                .setNewCommandTimeout(Duration.ofSeconds(120));
        String app = cfg.getProperty("app", "").trim();
        if (!app.isEmpty()) {
            options.setApp(app);
        } else {
            options.setAppPackage(cfg.getProperty("appPackage")).setAppActivity(cfg.getProperty("appActivity"));
        }
        return new AndroidDriver(URI.create(cfg.getProperty("appium.url")).toURL(), options);
    }
}
