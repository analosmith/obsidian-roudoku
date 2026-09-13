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

/** The match alternatives cover all characters, including leading punctuation. */
function sentences(text: string): string[] {
  return text.match(/[\s\S]*?[。！？.!?\n]+[」）】』〕”’]*|[\s\S]+$/gu) ?? [];
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
    // Code-point fallback also works on mobile versions without Intl.Segmenter.
    for (const point of sentence) {
      if (measure(point) > limit)
        throw new Error("Chunk limit cannot hold one character");
      if (measure(current + point) > limit) {
        result.push(current);
        current = "";
      }
      current += point;
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
