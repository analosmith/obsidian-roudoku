import { describe, it, expect } from "vitest";
import { chunkText, ssmlChunks, markdownToText } from "../src/text";

describe("lossless bounded narration", () => {
  it.each([
    "A".repeat(101),
    "。" + "文A。".repeat(30),
    "「終わり。」次。\n改行。",
    "😀".repeat(80),
    "！？。\n",
    "あ".repeat(10000),
  ])("preserves every input character: %s", (text) => {
    const chunks = chunkText(text, 50);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
    expect(
      chunks.every(
        (c) => !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c),
      ),
    ).toBe(true);
  });
  it("keeps closing quotes with sentence endings", () =>
    expect(chunkText("「終わり。」次の文。", 8)).toEqual([
      "「終わり。」",
      "次の文。",
    ]));
  it("rejects an impossible character budget", () =>
    expect(() => chunkText("😀", 1)).toThrow());
  it("bounds escaped SSML including tags in bytes", () => {
    const text = "あ<&😀。\n".repeat(500);
    const chunks = ssmlChunks(text, 5000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((c) => new TextEncoder().encode(c).length <= 5000),
    ).toBe(true);
    expect(
      chunks.every(
        (c) => c.startsWith("<speak><s>") && c.endsWith("</s></speak>"),
      ),
    ).toBe(true);
    const restored = chunks
      .map((c) =>
        c
          .replace(/<\/?(?:speak|s)>/g, "")
          .replaceAll('<break time="300ms"/>', "\n")
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&amp;", "&"),
      )
      .join("");
    expect(restored).toBe(text);
  });
  it("removes hidden content but retains labels and table text", () => {
    const text = markdownToText(
      "---\nprivate: hidden\n---\n# 見出し\n本文 [[ノート|表示名]] [リンク](https://example.com) ![画像](x.png)\n%%非公開%% <!--秘密-->\n```js\nsecret();\n```\n| 列 |\n| --- |\n| 値 |",
    );
    expect(text).toContain("見出し");
    expect(text).toContain("表示名");
    expect(text).toContain("リンク");
    expect(text).toContain("値");
    for (const hidden of [
      "hidden",
      "非公開",
      "秘密",
      "secret",
      "https",
      "画像",
    ])
      expect(text).not.toContain(hidden);
  });
});

it("keeps SSML sentence elements separate and caps long unpunctuated sentences", () => {
  const text = "最初の文です。次の文です。" + "あ".repeat(1000) + "😀<&。";
  const chunks = ssmlChunks(text, 1800);
  const elements = chunks.flatMap((c) =>
    [...c.matchAll(/<s>([\s\S]*?)<\/s>/g)].map((m) => m[0]),
  );
  expect(elements[0]).toBe("<s>最初の文です。</s>");
  expect(elements.every((s) => new TextEncoder().encode(s).length <= 600)).toBe(
    true,
  );
  expect(chunks.every((s) => new TextEncoder().encode(s).length <= 1800)).toBe(
    true,
  );
  const restored = chunks
    .join("")
    .replace(/<\/?(?:speak|s)>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  expect(restored).toBe(text);
});
