import { Before, After, AfterAll } from '@cucumber/cucumber';
import { PSWorld, closeBrowser } from './world';

Before(async function (this: PSWorld) {
  await this.initPlaywright();
});

After(async function (this: PSWorld) {
  await this.closeContext();
});

AfterAll(async function () {
  await closeBrowser();
});
