import { Given, When } from "@cucumber/cucumber";
import { PSWorld } from "../../support/world";
import { expect } from "playwright/test";

Given("I navigate to the login page", async function (this: PSWorld) {
  const { page } = this;
  await page.goto("https://vibetestq-osondemand.orangehrm.com/");
  await expect(page).toHaveTitle(/OrangeHRM/);
});

When(
  "I login with valid credentials {string} and {string}",
  async function (this: PSWorld, username, password) {
    const { page } = this;
    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Login" }).click();
  }
);
