import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

const pimHeading = (w: PSWorld) => w.page.getByRole('heading', { name: 'PIM' }).describe('PIM module heading');
const addEmployeeButton = (w: PSWorld) => w.page.getByRole('button', { name: 'Add' }).describe('Add employee button');

Then('I should see the PIM module', async function (this: PSWorld) {
  await expect(pimHeading(this)).toBeVisible();
});

When('I click on add button', async function (this: PSWorld) {
  await addEmployeeButton(this).click();
});
