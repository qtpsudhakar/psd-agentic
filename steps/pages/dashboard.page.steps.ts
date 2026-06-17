import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

const dashboardHeading = (w: PSWorld) => w.page.getByRole('heading', { name: 'Dashboard' }).describe('Dashboard page heading');
const pimLink = (w: PSWorld) => w.page.getByRole('link', { name: 'PIM' }).describe('PIM navigation link');

Then('I should be redirected to the dashboard page', async function (this: PSWorld) {
  await expect(dashboardHeading(this)).toBeVisible();
});

When('I click on the PIM link', async function (this: PSWorld) {
  await pimLink(this).click();
});
