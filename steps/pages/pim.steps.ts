import { When, Then } from "@cucumber/cucumber";
import { PSWorld } from "../../support/world";
import { expect } from "playwright/test";

When(
    "I navigate to the employee list page",
    async function (this: PSWorld) {
        const { page } = this;
        await page.getByRole("link", { name: "PIM" }).click();
    }
);

Then(
    "I should see the PIM module is accessible",
    async function (this: PSWorld) {
        const { page } = this;
        await expect(
            page.getByRole("heading", { name: "Employee Information" })
        ).toBeVisible();
    }
);

When("I click on add button", async function (this: PSWorld) {
    const { page } = this;
    await page.getByRole("button", { name: " Add" }).click();
});

Then("I should see the add employee form", async function (this: PSWorld) {
    const { page } = this;
    await expect(page.getByRole("heading", { name: "Add Employee" })).toBeVisible();
});

When(
    "I add a new employee with unique details",
    async function (this: PSWorld) {
        const { page, employeeData } = this;
        await page.getByPlaceholder("First Name").fill(employeeData.firstName);
        await page.getByPlaceholder("Last Name").fill(employeeData.lastName);
        await page.getByRole("button", { name: "Save" }).click();
    }
);

Then(
    "the employee should be created successfully",
    async function (this: PSWorld) {
        const { page } = this;
        await expect(page.getByRole("heading", { name: "Personal Details" })).toBeVisible();
    }
);
