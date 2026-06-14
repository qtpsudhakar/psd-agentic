import { When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

// ─── PIM Page Locators ────────────────────────────────────────────────────
const pimHeader = (w: PSWorld) => w.page.getByRole('heading', { name: 'PIM' }).describe('PIM page header');
const addButton = (w: PSWorld) => w.page.getByRole('button', { name: 'Add' }).describe('Add employee button');

// ─── PIM Page Steps ───────────────────────────────────────────────────────
Then('I should see the PIM module', async function (this: PSWorld) {
  await expect(pimHeader(this)).toBeVisible();
});

When('I click on add button', async function (this: PSWorld) {
  await addButton(this).click();
});
