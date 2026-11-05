import {
  readDocx,
  readPdf,
  makeDocx,
  makePdf,
  validateExport,
} from "./documents.mjs";
import { readImage } from "./image-reader.mjs";
import { createWorker } from "tesseract.js";
import { formats, imageFormats, readOther } from "./import-formats.mjs";
import { sourceLines } from "./engine.mjs";
const base = new URL("vendor/", self.location.href);
async function pdfReader(bytes, recognize) {
  const pdfjs = await import(new URL("pdf.min.mjs", base).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdf.worker.min.mjs",
    base,
  ).href;
  const port = new Worker(pdfjs.GlobalWorkerOptions.workerSrc, {
    type: "module",
  });
  pdfjs.GlobalWorkerOptions.workerPort = port;
  try {
    return await readPdf(
      bytes,
      pdfjs,
      {
        standardFontDataUrl: new URL("standard_fonts/", base).href,
        cMapUrl: new URL("cmaps/", base).href,
        cMapPacked: true,
      },
      recognize,
    );
  } finally {
    port.terminate();
    pdfjs.GlobalWorkerOptions.workerPort = null;
  }
}
async function font(name) {
  const r = await fetch(new URL(name, base));
  if (!r.ok) throw Error("The PDF font could not be loaded.");
  return r.arrayBuffer();
}
self.onmessage = async ({ data }) => {
  let ocr;
  const recognize = async (bytes) => {
    if (!ocr)
      ocr = await createWorker("eng", 1, {
        workerPath: new URL("ocr/worker.min.js", base).href,
        corePath: new URL("ocr/core/", base).href,
        langPath: new URL("ocr/lang/", base).href,
        workerBlobURL: false,
        cacheMethod: "none",
        logger: ({ status, progress }) =>
          self.postMessage({
            channel: "blumr-resume-progress",
            message:
              status === "recognizing text"
                ? "Reading scan on this device… " +
                  Math.round(progress * 100) +
                  "%"
                : "Preparing scan recognition on this device…",
          }),
      });
    return (await ocr.recognize(bytes)).data.text;
  };
  try {
    const parse = (bytes) =>
      data.format === "pdf" ? pdfReader(bytes) : readDocx(bytes);
    if (!formats.includes(data.format))
      throw Error("Choose a supported resume document or image.");
    if (data.operation === "read") {
      const bytes = new Uint8Array(data.bytes);
      if (!bytes.length || bytes.length > 10485760)
        throw Error("Choose a file up to 10 MB.");
      let parsed;
      if (data.format === "pdf") parsed = await pdfReader(bytes, recognize);
      else if (data.format === "docx") parsed = readDocx(bytes);
      else if (imageFormats.includes(data.format))
        parsed = {
          text: await readImage(bytes, data.format, recognize),
          warnings: [],
        };
      else parsed = readOther(bytes, data.format);
      if (ocr)
        parsed.warnings.push(
          "Text was recognized from an image using English OCR. Check every name, number, date, and qualification before confirming.",
        );
      sourceLines(parsed.text);
      self.postMessage({ channel: "blumr-resume-result", ok: true, ...parsed });
    } else if (data.operation === "export") {
      if (!["pdf", "docx"].includes(data.format))
        throw Error("Choose PDF or DOCX for export.");
      const serif = data.template === "classic";
      const bytes =
        data.format === "pdf"
          ? await makePdf(
              data.lines,
              ...(await Promise.all([
                font(serif ? "serif.ttf" : "regular.ttf"),
                font(serif ? "serif-bold.ttf" : "bold.ttf"),
              ])),
            )
          : await makeDocx(data.lines, data.template);
      validateExport(data.lines, (await parse(new Uint8Array(bytes))).text);
      globalThis.AncalagonUploadGuard.inspect(bytes, data.format);
      self.postMessage({ channel: "blumr-resume-result", ok: true, bytes }, [
        bytes.buffer,
      ]);
    } else throw Error("Unknown document operation.");
  } catch (e) {
    const message = String(e.message || "");
    self.postMessage({
      channel: "blumr-resume-result",
      ok: false,
      error:
        /^(Use |This |The |Word |Download blocked|A |Check |Choose |Encrypted|Unsupported|A page)/.test(
          message,
        )
          ? message
          : message,
    });
  } finally {
    if (ocr) await ocr.terminate();
    self.close();
  }
};
