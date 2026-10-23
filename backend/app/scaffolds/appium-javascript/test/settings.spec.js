import assert from 'node:assert';
import { remote } from 'webdriverio';
import { appium, capabilities } from '../config/appium.config.js';

// Needs a running Appium server and an Android device/emulator (see config/appium.config.js).
describe('Android Settings app', function () {
  let driver;

  before(async function () {
    driver = await remote({ ...appium, capabilities, logLevel: 'warn' });
  });

  after(async function () {
    if (driver) await driver.deleteSession();
  });

  it('is in the foreground', async function () {
    assert.strictEqual(await driver.getCurrentPackage(), capabilities['appium:appPackage']);
  });
});
