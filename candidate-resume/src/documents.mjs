import { Document, Paragraph, TextRun, Packer, HeadingLevel } from "docx";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readDocx } from "./docx-reader.mjs";
import "../../assets/pdf-text.js";
import "../../assets/upload-validation.js";

const maxPages = 80;
export async function readPdf(bytes, pdfjs, resources) {
  globalThis.AncalagonUploadGuard.inspect(bytes, "pdf");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    useWasm: false,
    stopAtErrors: true,
    ...resources,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > maxPages)
      throw Error("Use a resume with 80 pages or fewer.");
    const pages = [];
    let total = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const items = (await page.getTextContent()).items;
      const text = globalThis.AncalagonPdfText.pageText(items);
      if (!text.trim())
        throw Error(
          "A page has no extractable text. Paste the complete resume or use a text-based PDF.",
        );
      const links = (await page.getAnnotations())
        .filter((a) => a.subtype === "Link" && a.url)
        .map((a) => a.url);
      const extra = [...new Set(links)].filter(
        (url) =>
          !text.includes(url) && !text.includes(url.replace(/^mailto:/i, "")),
      );
      const result = [text, ...extra].join("\n");
      total += result.length;
      if (total > 95000)
        throw Error("The extracted PDF text exceeds the resume limit.");
      pages.push(result);
      page.cleanup();
    }
    return {
      text: pages.join("\n"),
      warnings: [
        "Compare the text with your PDF. Check columns, links and any information shown in images.",
      ],
    };
  } finally {
    await task.destroy();
  }
}
export async function makeDocx(lines, template = "modern") {
  const paragraphs = lines.map(
    ({ text, kind }) =>
      new Paragraph({
        ...(kind === "name"
          ? { heading: HeadingLevel.TITLE }
          : kind === "heading"
            ? { heading: HeadingLevel.HEADING_1 }
            : {}),
        spacing: {
          before: kind === "heading" ? 160 : 0,
          after: kind === "name" ? 140 : 65,
        },
        keepNext: kind === "heading" || kind === "name",
        children: [
          new TextRun({
            text,
            font: template === "classic" ? "Georgia" : "Calibri",
            size: kind === "name" ? 36 : kind === "heading" ? 25 : 22,
            bold: kind === "heading" || kind === "name",
            color: "172D26",
          }),
        ],
      }),
  );
  const doc = new Document({
    creator: "blumr Resume",
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 900, bottom: 900, left: 960, right: 960 },
          },
        },
        children: paragraphs,
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
export async function makePdf(lines, regularBytes, boldBytes) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle("Resume");
  doc.setCreator("blumr Resume");
  const regular = await doc.embedFont(regularBytes, {
    subset: true,
    features: { liga: false, clig: false },
  });
  const bold = await doc.embedFont(boldBytes, {
    subset: true,
    features: { liga: false, clig: false },
  });
  const coverage = new Map(
    [regular, bold].map((f) => [f, new Set(f.getCharacterSet())]),
  );
  const width = 612,
    height = 792,
    margin = 48;
  let page,
    y = 0;
  function ensure(space) {
    if (!page || y - space < margin) {
      if (doc.getPageCount() >= maxPages)
        throw Error("This layout exceeds 80 pages.");
      page = doc.addPage([width, height]);
      y = height - margin;
    }
  }
  for (const { text, kind } of lines) {
    const title = kind === "name",
      head = kind === "heading",
      font = title || head ? bold : regular,
      size = title ? 19 : head ? 13 : 10.5,
      leading = size * 1.45;
    if (
      [...text].some(
        (c) => !(/\s/u.test(c) || coverage.get(font).has(c.codePointAt(0))),
      )
    )
      throw Error(
        "The PDF font cannot represent a character. Use Word to preserve the approved text.",
      );
    ensure(leading + (head || title ? 28 : 0));
    if (head) y -= 8;
    let line = "";
    function draw() {
      ensure(leading);
      y -= leading;
      page.drawText(line, {
        x: margin,
        y,
        font,
        size,
        color: rgb(0.09, 0.16, 0.13),
      });
    }
    for (const word of text.split(/\s+/u)) {
      if (font.widthOfTextAtSize(word, size) > width - margin * 2)
        throw Error(
          "A long unbroken word or URL cannot fit the PDF page. Use Word or edit the line.",
        );
      const next = line ? line + " " + word : word;
      if (line && font.widthOfTextAtSize(next, size) > width - margin * 2) {
        draw();
        line = word;
      } else line = next;
    }
    if (line) draw();
    y += title ? -6 : -2;
  }
  return doc.save();
}
export function validateExport(lines, extracted) {
  const canonical = (s) => s.replace(/\s+/gu, " ").trim();
  if (canonical(lines.map((l) => l.text).join(" ")) !== canonical(extracted))
    throw Error(
      "Download blocked. The exported document did not preserve every approved word in order.",
    );
}
export { readDocx };
