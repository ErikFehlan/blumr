import { Unzip, UnzipInflate } from "fflate";
import { SaxesParser } from "saxes";
import "../../assets/upload-validation.js";

const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const relationships =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const decoder = new TextDecoder("utf-8", { fatal: true });
function parts(bytes) {
  globalThis.AncalagonUploadGuard.inspect(bytes, "docx");
  let expanded = 0;
  const result = new Map();
  const zip = new Unzip((entry) => {
    if (
      !/^word\/(?:document|numbering|header\d+|footer\d+)\.xml$|^word\/_rels\/(?:document|header\d+|footer\d+)\.xml\.rels$/.test(
        entry.name,
      )
    )
      return;
    if (result.has(entry.name) || result.size >= 80)
      throw Error("Unsupported Word archive structure.");
    const chunks = [];
    result.set(entry.name, chunks);
    entry.ondata = (err, chunk) => {
      if (err) throw err;
      expanded += chunk.length;
      if (expanded > 8 * 1024 * 1024)
        throw Error("Word document is too large to inspect safely.");
      chunks.push(chunk);
    };
    entry.start();
  });
  zip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 8192)
    zip.push(bytes.subarray(i, i + 8192), i + 8192 >= bytes.length);
  return result;
}
function readXML(chunks, open, close, chars = () => {}) {
  if (!chunks) return;
  const length = chunks.reduce((s, c) => s + c.length, 0),
    bytes = new Uint8Array(length);
  let i = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, i);
    i += chunk.length;
  }
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => {
    throw Error("Word documents containing a DTD cannot be imported.");
  });
  parser.on("opentag", open);
  parser.on("closetag", close);
  parser.on("text", chars);
  parser.write(decoder.decode(bytes)).close();
}
export function readDocx(bytes) {
  const files = parts(bytes),
    warnings = new Set(),
    output = [];
  const sectionParts = { header: new Set(), footer: new Set() };
  const relId = (n) =>
    Object.values(n.attributes).find(
      (a) => a.uri === relationships && a.local === "id",
    )?.value;
  const attr = (n, local) =>
    Object.values(n.attributes).find((a) => a.uri === word && a.local === local)
      ?.value;
  const levels = new Map(),
    lists = new Map();
  let abstractId, level, num;
  readXML(
    files.get("word/numbering.xml"),
    (n) => {
      if (n.uri !== word) return;
      if (n.local === "abstractNum") abstractId = attr(n, "abstractNumId");
      if (n.local === "lvl") level = attr(n, "ilvl");
      if (n.local === "numFmt" && abstractId !== undefined)
        levels.set(abstractId + "/" + level, attr(n, "val"));
      if (n.local === "num") num = attr(n, "numId");
      if (n.local === "abstractNumId" && num !== undefined)
        lists.set(num, attr(n, "val"));
      if (n.local === "lvl" && num !== undefined) lists.set(num, null);
    },
    (n) => {
      if (n.local === "abstractNum") abstractId = undefined;
      if (n.local === "num") num = undefined;
    },
  );
  // Imported Word text can include private contact details in headers/footers.
  function paragraphs(name) {
    const links = new Map(),
      sectionTargets = new Map();
    readXML(
      files.get(name.replace("word/", "word/_rels/") + ".rels"),
      (node) => {
        if (
          node.local === "Relationship" &&
          node.attributes.Type?.value.endsWith("/hyperlink")
        )
          links.set(node.attributes.Id.value, node.attributes.Target.value);
        if (
          node.local === "Relationship" &&
          /\/(?:header|footer)$/.test(node.attributes.Type?.value || "")
        )
          sectionTargets.set(
            node.attributes.Id.value,
            node.attributes.Target.value,
          );
      },
      () => {},
    );
    const lines = [];
    let value = "",
      inText = false,
      listId = null,
      listLevel = "0",
      href = null,
      skipped = 0,
      hiddenRun = false,
      runText = "";
    const parents = [],
      runs = [];
    readXML(
      files.get(name),
      (n) => {
        if (n.uri !== word) return;
        if (["del", "moveFrom"].includes(n.local)) {
          skipped++;
          warnings.add(
            "Tracked changes are shown with insertions kept and deletions removed. Review the final text.",
          );
        }
        if (skipped) return;
        if (["drawing", "pict", "object", "altChunk"].includes(n.local))
          warnings.add(
            "Check information in pictures or embedded objects against the original; only document text is extracted.",
          );
        if (["fldSimple", "instrText"].includes(n.local))
          warnings.add(
            "Saved field values are included; check dates and contact details.",
          );
        if (["footnoteReference", "endnoteReference", "sym"].includes(n.local))
          warnings.add(
            "Check footnotes, endnotes, and special symbols against the original.",
          );
        if (n.local === "vanish")
          hiddenRun = attr(n, "val") !== "0" && attr(n, "val") !== "false";
        if (n.local === "r") {
          runs.push({ hiddenRun, runText });
          hiddenRun = false;
          runText = "";
        }
        if (n.local === "p") {
          if (parents.length && runText) {
            value += runText;
            runText = "";
          }
          parents.push({ value, listId, listLevel });
          value = "";
          listId = null;
          listLevel = "0";
        }
        if (n.local === "numId") listId = attr(n, "val");
        if (n.local === "ilvl") listLevel = attr(n, "val");
        if (n.local === "headerReference" || n.local === "footerReference") {
          const kind = n.local === "headerReference" ? "header" : "footer";
          const target = (sectionTargets.get(relId(n)) || "").replace(
            /^\/word\//,
            "",
          );
          if (
            !new RegExp("^" + kind + "\\d+\\.xml$").test(target) ||
            !files.has("word/" + target)
          )
            throw Error(
              "This Word section cannot be resolved. Paste the complete visible text.",
            );
          sectionParts[kind].add("word/" + target);
        }
        if (n.local === "tbl" || n.local === "cols")
          warnings.add(
            "Check the reading order, especially tables or columns.",
          );
        if (n.local === "t") inText = true;
        if (n.local === "noBreakHyphen") runText += "‑";
        if (n.local === "softHyphen") runText += "\u00ad";
        if (n.local === "tab") runText += " ";
        if (n.local === "br" || n.local === "cr") runText += "\n";
        if (n.local === "hyperlink") {
          const id = Object.values(n.attributes).find(
            (a) => a.uri === relationships && a.local === "id",
          )?.value;
          href = links.get(id);
        }
      },
      (n) => {
        if (n.uri !== word) return;
        if (["del", "moveFrom"].includes(n.local)) {
          skipped--;
          return;
        }
        if (skipped) return;
        if (n.local === "r") {
          if (!hiddenRun) value += runText;
          ({ hiddenRun, runText } = runs.pop() || {
            hiddenRun: false,
            runText: "",
          });
        }
        if (n.local === "t") inText = false;
        if (n.local === "hyperlink" && href) {
          if (
            !value.includes(href) &&
            !value.includes(href.replace(/^mailto:/i, ""))
          )
            value += " (" + href + ")";
          href = null;
        }
        if (n.local === "p" && value.trim()) {
          const list = listId !== null && listId !== "0";
          if (
            list &&
            levels.get(lists.get(listId) + "/" + listLevel) !== "bullet"
          )
            warnings.add(
              "List items are imported as bullets. Check any meaningful numbering.",
            );
          const text = (list ? "• " : "") + value.trim();
          if (parents.length > 1)
            parents[parents.length - 1].value += "\n" + text + "\n";
          else lines.push(text);
        }
        if (n.local === "p")
          ({ value, listId, listLevel } = parents.pop() || {
            value: "",
            listId: null,
            listLevel: "0",
          });
      },
      (s) => {
        if (inText && !skipped) runText += s;
      },
    );
    return lines;
  }
  const main = paragraphs("word/document.xml");
  const outer = (kind) =>
    [...sectionParts[kind]].flatMap((name) => paragraphs(name));
  const head = outer("header"),
    foot = outer("footer");
  if (head.length || foot.length)
    warnings.add("Header and footer text is included. Check its placement.");
  output.push(...head, ...main, ...foot);
  return { text: output.join("\n"), warnings: [...warnings] };
}
