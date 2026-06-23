import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

const addEmployeeHeading = (w: PSWorld) => w.page.getByRole('heading', { name: 'Add Employee' }).describe('Add Employee form heading');
const firstNameInput = (w: PSWorld) => w.page.getByRole('textbox', { name: 'First Name' }).describe('First name input field');
const middleNameInput = (w: PSWorld) => w.page.getByRole('textbox', { name: 'Middle Name' }).describe('Middle name input field');
const lastNameInput = (w: PSWorld) => w.page.getByRole('textbox', { name: 'Last Name' }).describe('Last name input field');
const saveButton = (w: PSWorld) => w.page.getByRole('button', { name: 'Save' }).describe('Save employee button');
const employeeIdInput = (w: PSWorld) => w.page.getByRole('textbox', { name: 'Employee Id' }).describe('Employee id input field');

Then('I should see the add employee form', async function (this: PSWorld) {
  await expect(addEmployeeHeading(this)).toBeVisible();
});

Then('I read the employee id from the employee id textbox and store it in a variable', async function (this: PSWorld) {
  const id = await employeeIdInput(this).inputValue();
  (this as any).employeeId = id;
});

When('I add a new employee with unique details', async function (this: PSWorld) {
  const uniqueSuffix = Date.now().toString();
  await firstNameInput(this).fill(`Test${uniqueSuffix}`);
  await middleNameInput(this).fill(`Q${uniqueSuffix}`);
  await lastNameInput(this).fill(`User${uniqueSuffix}`);
  await saveButton(this).click();
});
