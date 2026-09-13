import { it, expect, vi } from "vitest";
import { SystemPlayer, type SpeechPort } from "../src/system-player";
import { parseSettings, loadGoogleKey } from "../src/settings";
import { synthesizeGoogle, type Transport } from "../src/google";
function port() {
  const ends: (() => void)[] = [];
  const rates: number[] = [];
  const speech: SpeechPort = {
    speak: vi.fn((_text, rate, end) => {
      rates.push(rate);
      ends.push(end);
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  return { speech, ends, rates };
}
it("starts standard speech synchronously and ignores cancelled utterances", () => {
  const { speech, ends } = port();
  const p = new SystemPlayer(speech);
  p.start(["A", "B"]);
  expect(speech.speak).toHaveBeenCalledTimes(1);
  p.stop();
  ends[0]?.();
  expect(speech.speak).toHaveBeenCalledTimes(1);
});
it("restarts the current standard chunk on speed change", () => {
  const { speech, ends, rates } = port();
  const p = new SystemPlayer(speech);
  p.start(["A", "B"]);
  p.setRate(1.5);
  ends[0]?.();
  expect(speech.speak).toHaveBeenCalledTimes(2);
  expect(rates).toEqual([1, 1.5]);
  ends[1]?.();
  expect(speech.speak).toHaveBeenCalledTimes(3);
});
it("does not lose next chunk if the end event arrives while paused", () => {
  const { speech, ends } = port();
  const p = new SystemPlayer(speech);
  p.start(["A", "B"]);
  p.pause();
  ends[0]?.();
  p.resume();
  expect(speech.speak).toHaveBeenCalledTimes(2);
});
it("uses new speed after changing it while paused", () => {
  const { speech, rates } = port();
  const p = new SystemPlayer(speech);
  p.start(["A"]);
  p.pause();
  p.setRate(0.75);
  expect(speech.speak).toHaveBeenCalledTimes(1);
  p.resume();
  expect(rates).toEqual([1, 0.75]);
});
it("drops unknown stored fields including raw credentials", () => {
  expect(
    JSON.stringify(
      parseSettings({
        apiKey: "private-test-value",
        googleSecretName: "valid-name",
        speed: 99,
      }),
    ),
  ).not.toContain("private-test-value");
  expect(parseSettings({ speed: 99 }).speed).toBe(1);
});
it("does not expose secret storage errors", () => {
  expect(
    loadGoogleKey(
      {
        getSecret() {
          throw new Error("private-value");
        },
      },
      "valid-name",
    ),
  ).toEqual({ state: "error", key: null });
});
it("builds Google requests at synthesis speed 1 and sanitizes HTTP failures", async () => {
  const request = vi.fn<Transport>(async () => ({
    status: 403,
    json: { error: { message: "private-value" } },
  }));
  await expect(
    synthesizeGoogle(
      "<speak>文</speak>",
      "dummy",
      "ja-JP-Chirp3-HD-Aoede",
      request,
    ),
  ).rejects.toThrow("APIキー");
  expect(request.mock.calls[0]?.[0]).toMatchObject({
    audioConfig: { speakingRate: 1 },
    input: { ssml: "<speak>文</speak>" },
  });
});
it("rejects oversized Google content before calling the network", async () => {
  const request = vi.fn();
  await expect(
    synthesizeGoogle(
      "あ".repeat(2000),
      "dummy",
      "ja-JP-Chirp3-HD-Aoede",
      request,
    ),
  ).rejects.toThrow("上限");
  expect(request).not.toHaveBeenCalled();
});
