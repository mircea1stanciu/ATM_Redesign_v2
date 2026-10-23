// Appium server started with: appium (default http://127.0.0.1:4723)
export const appium = {
  hostname: process.env.APPIUM_HOST || '127.0.0.1',
  port: Number(process.env.APPIUM_PORT || 4723),
  path: '/',
};

// Device id from "adb devices" (an Android Studio emulator is usually emulator-5554).
// Sample target: the Android Settings app. Replace with your app or set 'appium:app'.
export const capabilities = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': process.env.DEVICE_NAME || 'emulator-5554',
  'appium:appPackage': 'com.android.settings',
  'appium:appActivity': '.Settings',
};
