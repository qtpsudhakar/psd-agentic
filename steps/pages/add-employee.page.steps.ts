import { When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

// ─── Add Employee Page Locators ───────────────────────────────────────────
const addEmployeeHeader = (w: PSWorld) => w.page.getByRole('heading', { name: 'Add Employee' }).describe('Add Employee page header');
const firstNameInput = (w: PSWorld) => w.page.getByPlaceholder('First Name').describe('First name input field');
const middleNameInput = (w: PSWorld) => w.page.getByPlaceholder('Middle Name').describe('Middle name input field');
const lastNameInput = (w: PSWorld) => w.page.getByPlaceholder('Last Name').describe('Last name input field');
const saveButton = (w: PSWorld) => w.page.getByRole('button', { name: 'Save' }).describe('Save employee button');

// ─── Add Employee Page Steps ──────────────────────────────────────────────
Then('I should see the add employee form', async function (this: PSWorld) {
  await expect(addEmployeeHeader(this)).toBeVisible();
});

When('I add a new employee with unique details', async function (this: PSWorld) {
  const ts = Date.now();
  const first = `AutoFN_${ts}`;
  const last = `AutoLN_${ts}`;
  await firstNameInput(this).fill(first);
  await middleNameInput(this).fill('');
  await lastNameInput(this).fill(last);
  await saveButton(this).click();
});
