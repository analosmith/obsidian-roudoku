import { expect, it } from "vitest";
import { googleFailure } from "../src/google";
it.each([
  ["This request contains sentences that are too long.", "文が長すぎ"],
  ["SSML input is not supported for this voice.", "SSML"],
  ["Invalid SSML.", "SSML"],
  ["Voice not found.", "音声の指定"],
  ["API key not valid.", "APIキー"],
  ["private-note secret-example", "詳細分類できません"],
])("classifies without exposing upstream text: %s", (message, expected) => {
  const result = googleFailure(400, { error: { message } });
  expect(result).toContain(expected);
  expect(result).toContain("HTTP 400");
  expect(result).not.toContain("private-note");
  expect(result).not.toContain("secret-example");
});
it("handles malformed upstream data without exposing arbitrary fields", () => {
  expect(
    googleFailure(400, { error: { message: 123, details: "secret-example" } }),
  ).toContain("詳細分類できません");
});
