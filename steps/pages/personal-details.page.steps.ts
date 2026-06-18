import { Then } from '@cucumber/cucumber';
// import { expect } from '@playwright/test';
import { PSWorld,expect } from '../../support/world';

const personalDetailsHeading = (w: PSWorld) => w.page.getByRole('heading', { name: 'Personal Details' }).describe('Personal Details page heading');

Then('I see the personal details page', async function (this: PSWorld) {
  await expect(personalDetailsHeading(this)).toBeVisible();
});
