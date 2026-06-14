import { When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

// ─── Dashboard Page Locators ───────────────────────────────────────────────
const dashboardHeader = (w: PSWorld) => w.page.getByRole('heading', { name: 'Dashboard' }).describe('Dashboard page header');
const pimLink = (w: PSWorld) => w.page.getByRole('link', { name: 'PIM' }).describe('PIM module link');

// ─── Dashboard Page Steps ─────────────────────────────────────────────────
Then('I should be redirected to the dashboard page', async function (this: PSWorld) {
  await expect(dashboardHeader(this)).toBeVisible();
});

When('I click on the PIM link', async function (this: PSWorld) {
  await pimLink(this).click();
});
