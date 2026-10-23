const assert = require('node:assert');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const BASE_URL = process.env.BASE_URL || 'https://www.selenium.dev/selenium/web/';

describe('Web form', function () {
  let driver;

  beforeEach(async function () {
    const options = new chrome.Options();
    if (process.env.HEADED !== '1') options.addArguments('--headless=new', '--window-size=1920,1080');
    // Selenium Manager downloads a matching chromedriver automatically.
    driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    await driver.get(BASE_URL + 'web-form.html');
  });

  afterEach(async function () {
    if (driver) await driver.quit();
  });

  it('shows the form', async function () {
    assert.strictEqual(await driver.getTitle(), 'Web form');
    assert.strictEqual(await driver.findElement(By.css('h1')).getText(), 'Web form');
  });

  it('submits the form', async function () {
    await driver.findElement(By.id('my-text-id')).sendKeys('Hello from ATM');
    await driver.findElement(By.css('button[type=submit]')).click();
    await driver.wait(until.urlContains('submitted-form'), 10000);
    assert.strictEqual(await driver.findElement(By.css('h1')).getText(), 'Form submitted');
    assert.strictEqual(await driver.findElement(By.id('message')).getText(), 'Received!');
  });
});
