import { When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

// ─── Logout Page Locators ──────────────────────────────────────────────────
const userProfileMenuTrigger = (w: PSWorld) => w.page.getByRole('img', { name: 'profile picture' }).describe('User profile picture trigger for dropdown menu');
const logoutOption = (w: PSWorld) => w.page.getByRole('menuitem', { name: 'Logout' }).describe('Logout menu item in user profile dropdown');
const loginPageHeading = (w: PSWorld) => w.page.getByRole('heading', { name: 'Login' }).describe('Login page heading confirming return to login');

// ─── Logout Page Steps ─────────────────────────────────────────────────────

When('I open the user profile menu', async function (this: PSWorld) {
  await userProfileMenuTrigger(this).click();
});

When('I click on the logout option', async function (this: PSWorld) {
  await logoutOption(this).click();
});

Then('I should be returned to the login page', async function (this: PSWorld) {
  await expect(loginPageHeading(this)).toBeVisible();
});
