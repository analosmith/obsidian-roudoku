import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, RootContent } from "mdast";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter);
const ignored = new Set([
  "yaml",
  "code",
  "inlineCode",
  "html",
  "image",
  "imageReference",
  "definition",
  "footnoteDefinition",
]);
function readNode(node: Root | RootContent): string {
  if (ignored.has(node.type)) return "";
  if (node.type === "text") return node.value;
  if (node.type === "break") return "\n";
  if ("children" in node) {
    const separator =
      node.type === "tableRow"
        ? "、"
        : ["root", "table", "list", "blockquote"].includes(node.type)
          ? "\n"
          : "";
    const result = node.children.map((n) => readNode(n)).join(separator);
    return ["heading", "paragraph", "listItem", "tableRow"].includes(node.type)
      ? `${result}\n`
      : result;
  }
  return "";
}
export function markdownToText(markdown: string): string {
  const prepared = markdown
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_m: string, target: string, label: string | undefined) =>
        label ?? target,
    )
    .replace(/https?:\/\/[^\s<>\])]+/g, "");
  return readNode(parser.parse(prepared))
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Preserve every character while avoiding periods inside numbers and abbreviations.
function sentences(text: string): string[] {
  const points = Array.from(text);
  const abbreviations = new Set(
    "mr mrs ms dr prof st sr jr vs e.g i.e inc ltd co corp u.s u.k a.m p.m approx dept est".split(
      " ",
    ),
  );
  const numberAbbreviations = new Set("no fig vol ch sec p pp".split(" "));
  const result: string[] = [];
  let start = 0;
  for (let i = 0; i < points.length; i++) {
    const c = points[i] ?? "";
    if (!/[。！？.!?．\n]/u.test(c)) continue;
    if (c === "." || c === "．") {
      const next = points[i + 1] ?? "";
      if (/[a-zA-Z0-9０-９]/u.test(next) && next) continue;
      let j = i;
      while (j > 0 && /[a-zA-Z.]/u.test(points[j - 1] ?? "")) j--;
      const word = points
        .slice(j, i)
        .join("")
        .toLowerCase()
        .replace(/^\.+|\.+$/g, "");
      if (abbreviations.has(word)) continue;
      if (
        numberAbbreviations.has(word) &&
        /^[ ]*[0-9０-９]/u.test(points.slice(i + 1).join(""))
      )
        continue;
    }
    let end = i + 1;
    while (
      end < points.length &&
      /[。！？.!?．\n」）】』〕”’]/u.test(points[end] ?? "")
    )
      end++;
    result.push(points.slice(start, end).join(""));
    start = end;
    i = end - 1;
  }
  if (start < points.length) result.push(points.slice(start).join(""));
  return result;
}
function bounded(
  text: string,
  limit: number,
  measure: (value: string) => number,
): string[] {
  if (!Number.isFinite(limit) || limit <= 0)
    throw new Error("Invalid chunk limit");
  const result: string[] = [];
  let current = "";
  for (const sentence of sentences(text)) {
    if (measure(current + sentence) <= limit) {
      current += sentence;
      continue;
    }
    if (current) {
      result.push(current);
      current = "";
    }
    if (measure(sentence) <= limit) {
      current = sentence;
      continue;
    }
    // Prefer a comma boundary before falling back to individual code points.
    const points = Array.from(sentence);
    let lastBreak = 0;
    for (let i = 0; i < points.length; i++) {
      const point = points[i] ?? "";
      if (measure(point) > limit)
        throw new Error("Chunk limit cannot hold one character");
      while (measure(current + point) > limit) {
        const chars = Array.from(current);
        const cut = lastBreak || chars.length;
        result.push(chars.slice(0, cut).join(""));
        current = chars.slice(cut).join("");
        lastBreak = 0;
      }
      current += point;
      const numericComma =
        point === "," &&
        /[0-9０-９]/u.test(points[i - 1] ?? "") &&
        /[0-9０-９]/u.test(points[i + 1] ?? "");
      if (/[、，,]/u.test(point) && !numericComma)
        lastBreak = Array.from(current).length;
    }
  }
  if (current) result.push(current);
  return result;
}
export function chunkText(text: string, maxChars = 200): string[] {
  return bounded(text, maxChars, (s) => s.length);
}
function escaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", '<break time="300ms"/>');
}
export function ssmlChunks(text: string, maxBytes = 4800): string[] {
  // XML 1.0 disallows these controls; Markdown text never needs them spoken.
  const valid = Array.from(text)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join("");

  const encoder = new TextEncoder();
  const size = (s: string) => encoder.encode(s).length;
  const wrap = (s: string) => "<speak>" + s + "</speak>";
  const sentence = (s: string) => "<s>" + escaped(s) + "</s>";
  // Bound each sentence as well as the request. 600 is a conservative local
  // budget, not a claim about Google's documented per-sentence quota.
  const budget = Math.min(600, maxBytes - size(wrap("")));
  const chunks: string[] = [];
  let current = "";
  for (const part of sentences(valid)) {
    for (const piece of bounded(part, budget, (s) => size(sentence(s)))) {
      const xml = sentence(piece);
      if (size(wrap(current + xml)) > maxBytes) {
        if (current) chunks.push(wrap(current));
        current = "";
      }
      current += xml;
    }
  }
  if (current) chunks.push(wrap(current));
  return chunks;
}

/** Only accepts the SSML shape generated above. Never slices XML or entities. */
export function splitSsmlForRetry(ssml: string): string[] {
  const wrap = (value: string) => "<speak>" + value + "</speak>";
  const inner = ssml.slice(7, -8);
  if (!ssml.startsWith("<speak>") || !ssml.endsWith("</speak>")) return [];
  const elements = inner.match(/<s>[\s\S]*?<\/s>/g) ?? [];
  if (elements.join("") !== inner || !elements.length) return [];
  if (elements.length > 1) return elements.map(wrap);
  const encoded = inner.slice(3, -4);
  const text = encoded
    .replaceAll('<break time="300ms"/>', "\n")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  // Reject anything outside our own encoder's output.
  if (escaped(text) !== encoded) return [];
  const points = Array.from(text);
  if (points.length < 2) return [];
  const midpoint = Math.floor(points.length / 2);
  let cut = midpoint;
  const candidates: number[] = [];
  for (
    let i = Math.max(1, Math.floor(points.length / 4));
    i <= Math.min(points.length - 1, Math.ceil((points.length * 3) / 4));
    i++
  ) {
    if (/[、，,;；：:\s。！？.!?]/u.test(points[i - 1] ?? ""))
      candidates.push(i);
  }
  candidates.sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint));
  cut = candidates[0] ?? cut;
  return [points.slice(0, cut).join(""), points.slice(cut).join("")].map(
    (piece) => wrap("<s>" + escaped(piece) + "</s>"),
  );
}

/** Decode only the SSML produced by this module for a matching transcript. */
export function spokenText(ssml: string): string {
  return ssml
    .replace(/<\/?(?:speak|s)>/g, "")
    .replaceAll('<break time="300ms"/>', "\n")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
