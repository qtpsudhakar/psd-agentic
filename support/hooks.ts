import { Before, After, AfterAll, setDefaultTimeout } from '@cucumber/cucumber';
import { PSWorld, closeBrowser } from './world';
import { expect } from '@playwright/test';

setDefaultTimeout(120_000);


Before(async function (this: PSWorld) {
  await this.initPlaywright();
  expect.configure({ timeout: 10000 });

});

After(async function (this: PSWorld) {
  await this.closeContext();
});

AfterAll(async function () {
  await closeBrowser();
});
