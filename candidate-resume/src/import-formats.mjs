import { Unzip, UnzipInflate } from "fflate";
import { SaxesParser } from "saxes";
import { Parser } from "htmlparser2";
import docToText from "../../assets/doc-to-text.js";

export { formats, imageFormats } from "./supported-formats.mjs";
const review =
  "Compare the extracted text with your original, including contact details and reading order.";
export function decodeText(bytes) {
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? "utf-16le"
      : bytes[0] === 254 && bytes[1] === 255
        ? "utf-16be"
        : "utf-8";
  let text;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  if (/[\x00-\x08\x0e-\x1f]/.test(text))
    throw Error("This file contains binary data rather than readable text.");
  return text;
}
export function readRtf(bytes) {
  const input = new TextDecoder("windows-1252").decode(bytes);
  if (!/^\{\\rtf\d/.test(input))
    throw Error("This file is not a valid RTF document.");
  let state = { skip: false, hidden: false, uc: 1 },
    stack = [],
    out = "",
    fallback = 0;
  const destinations = new Set(
    "fonttbl colortbl stylesheet info pict object objdata filetbl listtable listoverridetable revtbl generator datastore xmlnstbl fldinst annotation atnauthor atnid deleted".split(
      " ",
    ),
  );
  const append = (s) => {
    if (fallback) {
      fallback--;
      return;
    }
    if (!state.skip && !state.hidden) out += s;
  };
  for (let i = 0; i < input.length; ) {
    const c = input[i++];
    if (c === "{") {
      if (stack.length > 200) throw Error("This RTF is nested too deeply.");
      stack.push({ ...state });
    } else if (c === "}") {
      if (!stack.length) throw Error("This RTF is incomplete.");
      state = stack.pop();
    } else if (c !== "\\") {
      if (c !== "\r" && c !== "\n") append(c);
    } else {
      const tail = input.slice(i);
      const hex = /^'([a-f\d]{2})/i.exec(tail);
      if (hex) {
        append(
          new TextDecoder("windows-1252").decode(
            Uint8Array.of(parseInt(hex[1], 16)),
          ),
        );
        i += 3;
        continue;
      }
      const token = /^([a-z]+)(-?\d+)? ?/i.exec(tail);
      if (!token) {
        const sym = input[i++];
        if (sym === "*") state.skip = true;
        else if (sym === "~") append(" ");
        else if (sym === "_") append("‑");
        else if ("\\{}".includes(sym)) append(sym);
        continue;
      }
      i += token[0].length;
      const key = token[1],
        n = Number(token[2]);
      if (destinations.has(key)) state.skip = true;
      else if (key === "bin") {
        if (!Number.isInteger(n) || n < 0 || i + n > input.length)
          throw Error("This RTF contains invalid embedded data.");
        i += n;
      } else if (key === "uc") state.uc = Math.min(10, Math.max(0, n));
      else if (key === "u") {
        if (!state.skip && !state.hidden)
          out += String.fromCharCode(n < 0 ? n + 65536 : n);
        fallback = state.uc;
      } else if (key === "v") state.hidden = token[2] !== "0";
      else if (["par", "line", "row"].includes(key)) append("\n");
      else if (["tab", "cell"].includes(key)) append("\t");
      else if (
        {
          bullet: "•",
          emdash: "—",
          endash: "–",
          lquote: "‘",
          rquote: "’",
          ldblquote: "“",
          rdblquote: "”",
        }[key]
      )
        append(
          {
            bullet: "•",
            emdash: "—",
            endash: "–",
            lquote: "‘",
            rquote: "’",
            ldblquote: "“",
            rdblquote: "”",
          }[key],
        );
    }
    if (out.length > 95000)
      throw Error("The extracted text exceeds the resume limit.");
  }
  if (stack.length) throw Error("This RTF is incomplete.");
  return {
    text: out.trim(),
    warnings: [review, "Review fields and any content shown in pictures."],
  };
}
export function readHtml(bytes) {
  let text = "",
    skip = 0;
  const blocks = new Set([
    "p",
    "div",
    "li",
    "br",
    "tr",
    "h1",
    "h2",
    "h3",
    "section",
    "header",
    "footer",
  ]);
  // Parse text only: never insert uploaded markup into a document or fetch its URLs.
  const parser = new Parser(
    {
      onopentag(name) {
        if (["script", "style", "template", "noscript"].includes(name)) skip++;
        if (!skip && blocks.has(name)) text += "\n";
      },
      ontext(value) {
        if (!skip) text += value;
      },
      onclosetag(name) {
        if (["script", "style", "template", "noscript"].includes(name)) skip--;
        if (!skip && blocks.has(name)) text += "\n";
        if (!skip && name === "td") text += "\t";
      },
    },
    { decodeEntities: true },
  );
  parser.end(decodeText(bytes));
  return {
    text: text.trim(),
    warnings: [
      review,
      "HTML styling is not applied. Check for hidden or repeated content.",
    ],
  };
}
export function readOdt(bytes) {
  let text = "",
    found = false,
    expanded = 0,
    depth = 0,
    skipDepth = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => {
    throw Error("This document contains unsupported XML declarations.");
  });
  parser.on("opentag", (n) => {
    depth++;
    if (
      ["tracked-changes", "annotation", "binary-data"].includes(n.local) &&
      !skipDepth
    )
      skipDepth = depth;
    if (skipDepth) return;
    if (["p", "h", "line-break"].includes(n.local)) text += "\n";
    if (n.local === "tab") text += "\t";
    if (n.local === "s")
      text += " ".repeat(
        Math.min(
          100,
          Number(
            Object.values(n.attributes).find((a) => a.local === "c")?.value,
          ) || 1,
        ),
      );
  });
  parser.on("closetag", (n) => {
    if (!skipDepth && ["p", "h", "table-cell"].includes(n.local)) text += "\n";
    if (depth === skipDepth) skipDepth = 0;
    depth--;
  });
  parser.on("text", (s) => {
    if (!skipDepth) text += s;
  });
  const zip = new Unzip((entry) => {
    if (entry.name !== "content.xml") return;
    if (found)
      throw Error("This OpenDocument archive contains duplicate content.");
    found = true;
    entry.ondata = (err, chunk, final) => {
      if (err) throw err;
      expanded += chunk.length;
      if (expanded > 8 * 1024 * 1024)
        throw Error("This document exceeds the safe processing limit.");
      parser.write(decoder.decode(chunk, { stream: !final }));
      if (final) parser.close();
    };
    entry.start();
  });
  zip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 8192)
    zip.push(bytes.subarray(i, i + 8192), i + 8192 >= bytes.length);
  if (!found)
    throw Error("This file does not contain an OpenDocument text document.");
  return {
    text: text.trim(),
    warnings: [
      review,
      "Check headers, footers, and information in pictures against the original.",
    ],
  };
}
export function readOther(bytes, format) {
  if (format === "rtf") return readRtf(bytes);
  if (format === "odt") return readOdt(bytes);
  if (["html", "htm"].includes(format)) return readHtml(bytes);
  if (format === "doc") {
    globalThis.AncalagonUploadGuard.inspect(bytes, "doc");
    const doc = docToText.sections(bytes);
    if (!doc)
      throw Error(
        "This legacy Word file is encrypted, damaged, or too old. Save it as DOCX or PDF and retry.",
      );
    return {
      text: [
        doc.headers,
        doc.headerTextboxes,
        doc.body,
        doc.textboxes,
        doc.footnotes,
        doc.endnotes,
      ]
        .filter(Boolean)
        .join("\n"),
      warnings: [
        review,
        "Tracked changes use the final text. Check text boxes and header placement.",
      ],
    };
  }
  return { text: decodeText(bytes), warnings: [review] };
}
