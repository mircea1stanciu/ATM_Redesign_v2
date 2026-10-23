const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: process.env.BASE_URL || 'https://www.selenium.dev/selenium/web/',
    supportFile: false,
    video: false,
    specPattern: 'cypress/e2e/**/*.cy.js',
  },
});
