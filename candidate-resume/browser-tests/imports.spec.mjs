import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
const require = createRequire(import.meta.url);
const { createCanvas } = require("@napi-rs/canvas");
const { buildDoc } = require("../../tests/fixtures/legacy-doc.cjs");

test("image, scanned PDF, and legacy DOC import locally and remain correctable", async ({
  page,
}) => {
  test.setTimeout(180000);
  const remote = [];
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith("http://127.0.0.1:4173/")
    )
      remote.push(r.url());
  });
  const canvas = createCanvas(1400, 650),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1400, 650);
  ctx.fillStyle = "black";
  ctx.font = "40px sans-serif";
  [
    "JANE AVERY",
    "Software Engineer",
    "Experience",
    "Built Azure services with SQL.",
    "Reduced processing time by 25 percent.",
  ].forEach((text, i) => ctx.fillText(text, 60, 90 + i * 80));
  const png = canvas.toBuffer("image/png");
  const pdf = await PDFDocument.create(),
    im = await pdf.embedPng(png);
  pdf
    .addPage([700, 325])
    .drawImage(im, { x: 0, y: 0, width: 700, height: 325 });
  for (const [name, mimeType, buffer, expected, ocr] of [
    ["scan.png", "image/png", png, /Built Azure services with SQL/, true],
    [
      "scan.pdf",
      "application/pdf",
      Buffer.from(await pdf.save()),
      /Built Azure services with SQL/,
      true,
    ],
    ["legacy.doc", "application/msword", Buffer.from(buildDoc()), /./, false],
  ]) {
    await page.goto("/?guest=1");
    await page
      .locator("#job")
      .fill("Required: Azure experience and SQL development.");
    await page.locator("#next-job").click();
    await page.locator("#file").setInputFiles({ name, mimeType, buffer });
    await expect(page.locator("#source")).toHaveValue(expected, {
      timeout: 60000,
    });
    await expect(page.locator("#source")).toBeEditable();
    if (ocr)
      await expect(page.locator("#extract-warning")).toContainText("OCR");
    await page.locator("#source-ok").check();
    await page
      .locator("#source")
      .fill("Jane Avery\nSoftware Engineer\nBuilt Azure services with SQL.");
    await expect(page.locator("#source-ok")).not.toBeChecked();
  }
  expect(remote).toEqual([]);
});
