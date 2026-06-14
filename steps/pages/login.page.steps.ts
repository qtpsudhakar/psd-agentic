import { Given, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

// ─── Login Page Locators ───────────────────────────────────────────────────
const usernameInput = (w: PSWorld) => w.page.getByRole('textbox', { name: 'Username' }).describe('Username input field');
const passwordInput = (w: PSWorld) => w.page.getByRole('textbox', { name: 'Password' }).describe('Password input field');
const loginButton = (w: PSWorld) => w.page.getByRole('button', { name: 'Login' }).describe('Login submit button');

// ─── Login Page Steps ──────────────────────────────────────────────────────
Given('I navigate to the login page', async function (this: PSWorld) {
  await this.page.goto('/');
  await expect(loginButton(this)).toBeVisible();
});

When('I login with valid credentials {string} and {string}', async function (this: PSWorld, username: string, password: string) {
  await usernameInput(this).fill(username);
  await passwordInput(this).fill(password);
  await loginButton(this).click();
});
