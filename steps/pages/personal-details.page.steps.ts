import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

// ─── Personal Details Page Locators ───────────────────────────────────────
const personalDetailsHeader = (w: PSWorld) => w.page.getByRole('heading', { name: 'Personal Details' }).describe('Personal Details header');

// ─── Personal Details Page Steps ──────────────────────────────────────────
Then('I see the personal details page', async function (this: PSWorld) {
  await expect(personalDetailsHeader(this)).toBeVisible({timeout: 10000});
});
