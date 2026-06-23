import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

const pimHeading = (w: PSWorld) => w.page.getByRole('heading', { name: 'PIM' }).describe('PIM module heading');
const addEmployeeButton = (w: PSWorld) => w.page.getByRole('button', { name: 'Add' }).describe('Add employee button');
const pimSearchInput = (w: PSWorld) => w.page.getByRole('textbox', { name: 'Employee Id' }).describe('PIM employee id search input');
const pimSearchButton = (w: PSWorld) => w.page.getByRole('button', { name: 'Search' }).describe('PIM search button');
const pimSearchResult = (w: PSWorld, id: string) => w.page.getByText(id).describe('Search result row for employee id');

Then('I should see the PIM module', async function (this: PSWorld) {
  await expect(pimHeading(this)).toBeVisible();
});

When('I click on add button', async function (this: PSWorld) {
  await addEmployeeButton(this).click();
});

When('I search for the newly added employee using the stored employee id', async function (this: PSWorld) {
  const id = (this as any).employeeId;
  await pimSearchInput(this).fill(id);
  await pimSearchButton(this).click();
});

Then('I should see the employee record created in the search results', async function (this: PSWorld) {
  const id = (this as any).employeeId;
  await expect(pimSearchResult(this, id)).toBeVisible();
});
