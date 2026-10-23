import { browser, $, expect } from '@wdio/globals';

describe('Web form', () => {
  beforeEach(async () => {
    await browser.url('web-form.html');
  });

  it('shows the form', async () => {
    await expect(browser).toHaveTitle('Web form');
    await expect($('h1')).toHaveText('Web form');
  });

  it('submits the form', async () => {
    await $('#my-text-id').setValue('Hello from ATM');
    await $('button[type=submit]').click();
    await expect($('h1')).toHaveText('Form submitted');
    await expect($('#message')).toHaveText('Received!');
  });
});
