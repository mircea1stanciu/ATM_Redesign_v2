const headless = process.env.HEADED !== '1';

export const config = {
  runner: 'local',
  specs: ['./test/specs/**/*.e2e.js'],
  maxInstances: 2,
  baseUrl: process.env.BASE_URL || 'https://www.selenium.dev/selenium/web/',
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': { args: headless ? ['--headless=new', '--disable-gpu'] : [] },
    },
  ],
  logLevel: 'warn',
  waitforTimeout: 10000,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 60000 },
};
