import { test, expect } from "@playwright/test";
import { Document, Packer, Paragraph } from "docx";
import { readFile } from "node:fs/promises";

test("candidate setup, one original for two jobs, fit coverage, independent versions, logout and deletion", async ({
  page,
}) => {
  const email = crypto.randomUUID() + "@example.test",
    password = crypto.randomUUID() + "aB1!";
  const role = (name) => page.getByRole("button", { name, exact: true });
  const visible = (locator) => expect(locator).toBeVisible({ timeout: 15000 });
  const home = async () => {
    await page.getByRole("link", { name: "My workspace" }).click();
    await visible(page.locator("#profile-home"));
  };
  async function credentials() {
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
  }
  await page.goto("/");
  await expect(page).toHaveURL(/login\.html$/);
  await expect(page.locator("#job")).toHaveCount(0);
  await role("Create account").click();
  await credentials();
  await page.locator("#submit-auth").click();
  await visible(page.getByRole("heading", { name: "Set up your profile." }));
  await page.getByLabel("Display name").fill("Alex");
  await page.getByLabel("Target role").fill("Data Analyst");
  await role("Save profile").click();
  await visible(page.getByRole("heading", { name: "Welcome, Alex." }));
  await page.locator("#base-editor summary").click();
  const bytes = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph("Alex Example"),
            new Paragraph("Maintained SQL reports."),
          ],
        },
      ],
    }),
  );
  await page
    .locator("#base-file")
    .setInputFiles({
      name: "Original.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: bytes,
    });
  await expect(page.locator("#base-text")).toHaveValue(
    /Maintained SQL reports/,
  );
  await page.locator("#base-confirm").check();
  await role("Save base resume").click();
  await expect(page.locator("#base-summary")).toContainText("Original.docx");
  for (const [index, [title, requirement, verdict]] of [
    ["Analyst", "SQL experience.", "Good fit"],
    ["Cloud engineer", "AWS experience.", "Stretch"],
  ].entries()) {
    await role("Add a position").click();
    if (index) await role("Continue").click();
    await page.locator("#title").fill(title);
    await page.locator("#employer").fill("Example");
    await page.locator("#job").fill("Required: " + requirement);
    await role("Save job").click();
    await expect(page.locator("#notice")).toContainText("Job saved");
    await page.locator("#next-job").click();
    await expect(page.locator("#source")).toHaveValue(/Maintained SQL reports/);
    await expect(page.locator("#source-ok")).toBeChecked();
    await page.locator("#tailor").click();
    await expect(page.locator("#fit-label")).toHaveText(verdict, {
      timeout: 15000,
    });
    if (!index) {
      await role("Save version").click();
      await expect(page.locator("#notice")).toHaveText("Version saved.");
    }
    await home();
  }
  await expect(page.locator("#saved-jobs .hub-row")).toHaveCount(2);
  await role("Sign out").click();
  await expect(page).toHaveURL(/login\.html$/);
  await credentials();
  await role("Sign in").click();
  await visible(page.getByRole("heading", { name: "Welcome, Alex." }));
  await expect(page.locator("#saved-jobs .hub-row")).toHaveCount(2);
  await page
    .locator("#saved-jobs .hub-row")
    .filter({ hasText: "Analyst" })
    .getByRole("button", { name: "Assess fit" })
    .click();
  await expect(page.locator("#fit-label")).toHaveText("Good fit");
  await home();
  await role("Remove base resume").click();
  await role("Continue").click();
  await expect(page.locator("#base-summary")).toContainText(
    "Save one reviewed",
  );
  await role("Open version").click();
  await role("Continue").click();
  await visible(page.locator("#review-panel"));
  await page.locator("#next-review").click();
  await expect(page.locator("#preview")).toContainText(
    "Maintained SQL reports.",
  );
  await expect(page.locator("#final-ok")).not.toBeChecked();
  await page.locator("#final-ok").check();
  const exported = page.waitForEvent("download");
  await page.locator("#docx").click();
  expect((await exported).suggestedFilename()).toBe("Analyst Resume.docx");
  await page.getByRole("button", { name: /02 Source resume/ }).click();
  const original = page.waitForEvent("download");
  await role("Download original · Original.docx").click();
  expect(await readFile(await (await original).path())).toEqual(bytes);
  await home();
  await role("Delete account and data").click();
  await role("Continue").click();
  await expect(page.locator("#login-status")).toContainText("deleted");
  await credentials();
  await role("Sign in").click();
  await expect(page.locator("#login-status")).toContainText(
    "Could not complete",
  );
  await expect(page.locator("#saved-jobs")).toHaveCount(0);
});
