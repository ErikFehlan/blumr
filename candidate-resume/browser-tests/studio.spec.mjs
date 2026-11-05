import { test, expect } from "@playwright/test";
import { Document, Packer, Paragraph } from "docx";
import { readFile } from "node:fs/promises";
import { readDocx, readPdf } from "../src/documents.mjs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
test("paste, review, block unsupported facts, approve, download and import both formats", async ({
  page,
}) => {
  const remote = [];
  const errors = [];
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith("http://127.0.0.1:4173/")
    )
      remote.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?guest=1");
  await page.getByText("Try a sample application").click();
  await page.locator("#next-job").click();
  await page.locator("#source-ok").check();
  await page.locator("#tailor").click();
  await expect(
    page.locator(".requirement").filter({ hasText: "AWS experience." }),
  ).toContainText("Not demonstrated");
  const edited = page
    .locator(".change")
    .filter({ has: page.locator("summary", { hasText: "Changed · Line 6" }) });
  await edited.getByText("Edit line", { exact: true }).click();
  await edited.locator("textarea").fill("- Claimed an AWS credential.");
  await page.locator("#next-review").click();
  await expect(page.locator("#notice")).toContainText("Confirm or undo");
  await edited.getByText("Restore source").click();
  await page.locator("#add").click();
  await page
    .getByLabel("Additional fact 1")
    .fill("Completed a volunteer project in 2024.");
  await page.locator("#next-review").click();
  await expect(page.locator("#notice")).toContainText("Confirm or undo");
  await page.getByLabel("I confirm this specific detail is accurate.").check();
  await page.locator("#next-review").click();
  await expect(page.locator("#pdf")).toBeDisabled();
  await expect(page.locator("#preview")).not.toContainText("AWS");
  await page.locator("#final-ok").check();
  await page.getByLabel("Document style").selectOption("classic");
  await expect(page.locator("#final-ok")).not.toBeChecked();
  await page.locator("#final-ok").check();
  const files = {};
  for (const format of ["docx", "pdf"]) {
    const download = page.waitForEvent("download");
    await page.locator("#" + format).click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(new RegExp("\\." + format + "$"));
    const bytes = await readFile(await d.path());
    if (format === "pdf") {
      expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(bytes.subarray(-1024).toString("latin1")).toContain("%%EOF");
    }
    const out =
      format === "pdf" ? await readPdf(bytes, pdfjs, {}) : readDocx(bytes);
    expect(out.text).toContain("volunteer project in 2024");
    expect(out.text).not.toContain("AWS");
    files[format] = {
      name: "Approved." + format,
      mimeType:
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: bytes,
    };
  }
  for (const format of ["docx", "pdf"]) {
    await page.reload();
    await page.locator("#job").fill("Required: Azure experience.");
    await page.locator("#next-job").click();
    await page.locator("#file").setInputFiles(files[format]);
    await expect(page.locator("#source")).toHaveValue(/volunteer project/);
    await expect(page.locator("#source")).toBeEditable();
    await expect(page.locator("#source-ok")).not.toBeChecked();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(remote).toEqual([]);
  expect(errors).toEqual([]);
});
test("failed upload allows clean retry and data clears on refresh", async ({
  page,
}) => {
  await page.goto("/?guest=1");
  await page.locator("#job").fill("Required: SQL experience.");
  await page.locator("#next-job").click();
  await page.locator("#file").setInputFiles({
    name: "bad.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.locator("#notice")).toContainText(/document|file/i);
  await expect(page.locator("#workspace")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#source")).toHaveValue("");
  const bytes = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph("Jordan Avery"),
            new Paragraph("Used SQL daily."),
          ],
        },
      ],
    }),
  );
  await page.locator("#file").setInputFiles({
    name: "valid.docx",
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
  await expect(page.locator("#source")).toHaveValue(/Used SQL daily/);
  await page.reload();
  await expect(page.locator("#job")).toHaveValue("");
});
test("preview login leads to a separate session-only candidate workspace", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/login\.html$/);
  await page.getByRole("link", { name: /Open demo workspace/ }).click();
  await page.getByLabel("Display name").fill("Jamie");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.locator("#base-editor summary").click();
  await page
    .getByLabel("Base resume text")
    .fill("Jamie Example\nMaintained Azure deployments.");
  await page.locator("#base-confirm").check();
  await page.locator("#base-save").click();
  await page.locator("#new-job").click();
  await page.locator("#job").fill("Required: AWS experience.");
  await page.locator("#title").fill("Cloud Engineer");
  await page.locator("#save-job").click();
  await page.getByRole("link", { name: "My workspace" }).click();
  await page.getByRole("button", { name: "Assess fit" }).click();
  await page.locator("#confirm-dialog-action").click();
  await expect(page.locator("#fit-label")).toHaveText("Stretch");
  await expect(page.locator("#fit-score")).toHaveText(
    "0 of 1 required qualifications supported",
  );
  await expect(page.locator("#source")).toHaveValue(/Maintained Azure/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Set up your profile." }),
  ).toBeVisible();
  await expect(page.locator("#display-name")).toHaveValue("");
});
