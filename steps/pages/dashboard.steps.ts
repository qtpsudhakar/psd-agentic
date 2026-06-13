import { Then } from "@cucumber/cucumber";
import { PSWorld } from "../../support/world";
import { expect } from "playwright/test";

Then(
  "I should be redirected to the dashboard page",
  async function (this: PSWorld) {
    const { page } = this;
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  }
);
