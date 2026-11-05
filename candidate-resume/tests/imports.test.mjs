import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { readDocx } from "../src/docx-reader.mjs";
import {
  readOther,
  readOdt,
  readRtf,
  readHtml,
} from "../src/import-formats.mjs";
const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const docx = (xml) =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<w:document xmlns:w="${w}"><w:body>${xml}</w:body></w:document>`,
    ),
  });
const run = (text) => `<w:r><w:t>${text}</w:t></w:r>`;
test("Word decorative shapes, saved fields, final revisions and textboxes are readable", () => {
  const input = docx(
    `<w:p><w:r><w:pict/></w:r>${run("Jane Avery")}</w:p><w:p><w:fldSimple w:instr="DATE">${run("2026")}</w:fldSimple></w:p><w:p><w:del>${run("Deleted claim")}</w:del><w:ins>${run("Maintained Azure")}</w:ins></w:p><w:p><w:r><w:drawing><w:txbxContent><w:p>${run("jane@example.com")}</w:p></w:txbxContent></w:drawing></w:r></w:p>`,
  );
  const result = readDocx(input);
  assert.equal(
    result.text,
    "Jane Avery\n2026\nMaintained Azure\njane@example.com",
  );
  assert.ok(result.warnings.length);
});
test("hidden text and field instructions do not become candidate claims", () => {
  assert.equal(
    readDocx(
      docx(
        `<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden AWS</w:t></w:r><w:r><w:instrText>HYPERLINK secret</w:instrText></w:r>${run("Azure")}</w:p>`,
      ),
    ).text,
    "Azure",
  );
});
test("RTF ignores pictures, instructions, and metadata; preserves Unicode and visible fields", () => {
  const input = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}Jane\par Jos\u233? Avery\par {\field{\*\fldinst HYPERLINK secret}{\fldrslt Portfolio}}{\pict abcd}\par Azure}`;
  assert.equal(
    readRtf(strToU8(input)).text,
    "Jane\nJosé Avery\nPortfolio\nAzure",
  );
  assert.throws(() => readRtf(strToU8("not rtf")));
  assert.throws(() => readRtf(strToU8("{\\rtf1 incomplete")));
});
test("ODT extracts paragraph/table text without revision history or XML entities", () => {
  const input = zipSync({
    "content.xml": strToU8(
      '<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><text:tracked-changes><text:p>Deleted AWS</text:p></text:tracked-changes><text:p>Jane Avery</text:p><text:p>Azure<text:tab/>Engineer</text:p></office:document>',
    ),
  });
  assert.equal(
    readOdt(input).text.replace(/\n+/g, "\n"),
    "Jane Avery\nAzure\tEngineer",
  );
  assert.throws(() =>
    readOdt(zipSync({ "content.xml": strToU8("<!DOCTYPE x><x/>") })),
  );
});
test("HTML is inert text, and UTF16 text imports without losing characters", () => {
  const result = readHtml(
    strToU8(
      '<h1>Jane &amp; Avery</h1><script>fetch("secret")</script><p>Azure</p>',
    ),
  );
  assert.equal(result.text.replace(/\n+/g, "\n"), "Jane & Avery\nAzure");
  const utf16 = Buffer.concat([
    Buffer.from([255, 254]),
    Buffer.from("José\nAzure", "utf16le"),
  ]);
  assert.equal(readOther(utf16, "txt").text, "José\nAzure");
  assert.throws(() => readOther(Uint8Array.of(0, 1, 2), "txt"));
});

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildDoc, EXPECTED } = require("../../tests/fixtures/legacy-doc.cjs");
test("legacy Word import uses the existing binary reader and preserves field results", () => {
  assert.equal(readOther(buildDoc(), "doc").text.trim(), EXPECTED.trim());
});
