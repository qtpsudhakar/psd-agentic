import { Given, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

const loginHeading = (w: PSWorld) => w.page.getByRole('heading', { name: 'Login' }).describe('Login page heading');
const usernameInput = (w: PSWorld) => w.page.getByRole('textbox', { name: 'Username' }).describe('Username input field');
const passwordInput = (w: PSWorld) => w.page.getByRole('textbox', { name: 'Password' }).describe('Password input field');
const loginButton = (w: PSWorld) => w.page.getByRole('button', { name: 'Login' }).describe('Login submit button');

Given('I navigate to the login page', async function (this: PSWorld) {
  await this.page.goto('/auth/login');
  await expect(loginHeading(this)).toBeVisible();
});

When('I login with valid credentials {string} and {string}', async function (this: PSWorld, username: string, password: string) {
  await usernameInput(this).fill(username);
  await passwordInput(this).fill(password);
  await loginButton(this).click();
});
