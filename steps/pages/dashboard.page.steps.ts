import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

const dashboardHeading = (w: PSWorld) => w.page.getByRole('heading', { name: 'Dashboard' }).describe('Dashboard page heading');
const pimLink = (w: PSWorld) => w.page.getByRole('link', { name: 'PIM' }).describe('PIM navigation link');
const userProfileMenu = (w: PSWorld) => w.page.locator('listitem').filter({ has: w.page.getByText('test admin') }).describe('User profile menu button');
const logoutOption = (w: PSWorld) => w.page.getByRole('menuitem', { name: 'Logout' }).describe('Logout menu option');
const loginHeading = (w: PSWorld) => w.page.getByRole('heading', { name: 'Login' }).describe('Login page heading');

Then('I should be redirected to the dashboard page', async function (this: PSWorld) {
  await expect(dashboardHeading(this)).toBeVisible();
});

When('I click on the PIM link', async function (this: PSWorld) {
  await pimLink(this).click();
});

When('I open the user profile menu', async function (this: PSWorld) {
  await userProfileMenu(this).click();
  await expect(logoutOption(this)).toBeVisible();
});

When('I click on the logout option', async function (this: PSWorld) {
  await logoutOption(this).click();
});

Then('I should be returned to the login page', async function (this: PSWorld) {
  await expect(loginHeading(this)).toBeVisible();
});
