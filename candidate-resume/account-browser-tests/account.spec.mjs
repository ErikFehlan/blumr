import { test, expect } from "@playwright/test";
import { Document, Packer, Paragraph } from "docx";
import { readFile } from "node:fs/promises";

test("save an uploaded original, reopen after sign-in, export and erase the account", async ({
  page,
}) => {
  const email = crypto.randomUUID() + "@example.test",
    password = crypto.randomUUID() + "aB1!";
  const role = (name) => page.getByRole("button", { name, exact: true });
  async function credentials() {
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
  }
  await page.goto("/");
  await credentials();
  await role("Create account").click();
  await expect(role("Save version")).toBeVisible();
  await page.locator("#job").fill("Required: SQL experience.");
  await page.locator("#title").fill("Data Analyst");
  await page.locator("#next-job").click();
  const original = await Packer.toBuffer(
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
    .locator("#file")
    .setInputFiles({
      name: "Original.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: original,
    });
  await expect(page.locator("#source")).toHaveValue(/Maintained SQL reports/);
  await page.locator("#source-ok").check();
  await page.locator("#tailor").click();
  await expect(page.locator("#review-panel")).toBeVisible();
  await role("Save version").click();
  await expect(role("Open version")).toHaveCount(1);
  await role("Save version").click();
  await expect(page.locator("#notice")).toHaveText("Version saved.");
  await expect(role("Open version")).toHaveCount(1);
  await role("Sign out").click();
  await expect(page.locator("#job")).toHaveValue("");
  await credentials();
  await role("Sign in").click();
  await role("Open version").click();
  await role("Continue").click();
  await expect(page.locator("#review-panel")).toBeVisible();
  await page.locator("#next-review").click();
  await expect(page.locator("#preview")).toContainText(
    "Maintained SQL reports.",
  );
  await expect(page.locator("#final-ok")).not.toBeChecked();
  await page.locator("#final-ok").check();
  const exported = page.waitForEvent("download");
  await page.locator("#docx").click();
  expect((await exported).suggestedFilename()).toBe("Data Analyst Resume.docx");
  await page.getByRole("button", { name: /02 Source resume/ }).click();
  const downloading = page.waitForEvent("download");
  await role("Download original · Original.docx").click();
  expect(await readFile(await (await downloading).path())).toEqual(original);
  await role("Delete account and data").click();
  await role("Continue").click();
  await expect(page.locator("#notice")).toContainText(
    "Account and saved application data deleted.",
  );
  await credentials();
  await role("Sign in").click();
  await expect(page.locator("#notice")).toContainText("could not finish");
  await expect(role("Open version")).toHaveCount(0);
});
