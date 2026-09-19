import { beforeEach } from "vitest";
import { afterEach, expect, it, vi } from "vitest";
import { CloudPlayer, NarrationError, type Clip } from "../src/cloud-player";
import { splitSsmlForRetry, ssmlChunks } from "../src/text";
import { synthesizeGoogle, GOOGLE_VOICES } from "../src/google";
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const long = () => new NarrationError("length", "sentence-too-long");
function clip() {
  let end = () => {};
  return {
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    stop: vi.fn(),
    setRate: vi.fn(),
    onEnd: (f: () => void) => {
      end = f;
    },
    onError: () => {},
    end: () => end(),
  };
}
afterEach(() => vi.useRealTimers());
it("splits grouped requests, plays all parts in order, keeps original progress", async () => {
  const a = clip(),
    b = clip();
  const request = vi
    .fn()
    .mockRejectedValueOnce(long())
    .mockResolvedValueOnce(a)
    .mockResolvedValueOnce(b);
  const p = new CloudPlayer(request, splitSsmlForRetry);
  p.start(["<speak><s>一。</s><s>二。</s></speak>"]);
  await flush();
  expect(request.mock.calls.map((x) => x[0])).toEqual([
    "<speak><s>一。</s><s>二。</s></speak>",
    "<speak><s>一。</s></speak>",
    "<speak><s>二。</s></speak>",
  ]);
  expect(p.snapshot.completed).toBe(0);
  a.end();
  await flush();
  expect(b.play).toHaveBeenCalledOnce();
  expect(p.snapshot.completed).toBe(0);
  b.end();
  await flush();
  expect(p.snapshot).toMatchObject({ state: "ended", completed: 1, total: 1 });
});
it("preserves Unicode, escaped entities and newlines through recursive splits", () => {
  const text = "😀<&amp; >日本語、abc\n終わり".repeat(30);
  const original = ssmlChunks(text, 1800);
  const decode = (xml: string) =>
    xml
      .replace(/<\/?(?:speak|s)>/g, "")
      .replaceAll('<break time="300ms"/>', "\n")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
  let pieces = original;
  for (let i = 0; i < 4; i++)
    pieces = pieces.flatMap((x) => {
      const parts = splitSsmlForRetry(x);
      return parts.length ? parts : [x];
    });
  expect(pieces.map(decode).join("")).toBe(text);
  expect(
    pieces.every(
      (x) =>
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          x,
        ),
    ),
  ).toBe(true);
});
it("bounds persistent failure and never retries other errors", async () => {
  const request = vi.fn(async () => {
    throw long();
  });
  const p = new CloudPlayer(request, splitSsmlForRetry);
  p.start(ssmlChunks("あ".repeat(100), 1800));
  await flush();
  await flush();
  expect(p.snapshot.state).toBe("error");
  expect(request.mock.calls.length).toBeLessThanOrEqual(5);
  const other = vi.fn(async () => {
    throw new NarrationError("auth");
  });
  const q = new CloudPlayer(other, splitSsmlForRetry);
  q.start(ssmlChunks("あ".repeat(100)));
  await flush();
  expect(other).toHaveBeenCalledOnce();
});
it("stop prevents retries after an outstanding rejection", async () => {
  let reject!: (e: unknown) => void;
  const request = vi.fn(
    () =>
      new Promise<Clip>((_, r) => {
        reject = r;
      }),
  );
  const p = new CloudPlayer(request, splitSsmlForRetry);
  p.start(ssmlChunks("あ".repeat(100)));
  await flush();
  p.stop();
  reject(long());
  await flush();
  expect(request).toHaveBeenCalledOnce();
  expect(p.snapshot.state).toBe("idle");
});
it("pause suspends recovery requests until resume", async () => {
  let reject!: (e: unknown) => void;
  const a = clip();
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Clip>((_, r) => {
          reject = r;
        }),
    )
    .mockResolvedValue(a);
  const p = new CloudPlayer(request, splitSsmlForRetry);
  p.start(ssmlChunks("あ".repeat(100)));
  await flush();
  p.pause();
  reject(long());
  await flush();
  expect(request).toHaveBeenCalledOnce();
  p.resume();
  await flush();
  expect(request).toHaveBeenCalledTimes(3);
  expect(a.play).toHaveBeenCalledOnce();
  p.stop();
});
it("times out and disposes a late response without playback", async () => {
  vi.useFakeTimers();
  let resolve!: (c: Clip) => void;
  const request = vi.fn(
    () =>
      new Promise<Clip>((r) => {
        resolve = r;
      }),
  );
  const p = new CloudPlayer(request, splitSsmlForRetry);
  p.start(["x"]);
  await flush();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(p.snapshot.state).toBe("error");
  const a = clip();
  resolve(a);
  await flush();
  expect(a.stop).toHaveBeenCalledOnce();
  expect(a.play).not.toHaveBeenCalled();
});
it("only Google HTTP400 sentence length errors receive the retry code", async () => {
  for (const status of [400, 500]) {
    try {
      await synthesizeGoogle(
        "<speak>x</speak>",
        "fake",
        GOOGLE_VOICES[0],
        async () => ({
          status,
          json: { error: { message: "sentences are too long" } },
        }),
      );
      throw Error("expected");
    } catch (e) {
      expect(e).toBeInstanceOf(NarrationError);
      expect((e as NarrationError).code).toBe(
        status === 400 ? "sentence-too-long" : undefined,
      );
    }
  }
});

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
});
it("bisects a rejected single sentence until every piece succeeds", async () => {
  const played: string[] = [];
  const clips: ReturnType<typeof clip>[] = [];
  const request = vi.fn(async (xml: string) => {
    const text = xml.replace(/<[^>]*>/g, "");
    if (Array.from(text).length > 10) throw long();
    played.push(text);
    const c = clip();
    clips.push(c);
    return c;
  });
  const p = new CloudPlayer(request, splitSsmlForRetry);
  const text = "日本語の長い文章".repeat(8);
  p.start(ssmlChunks(text));
  await flush();
  while (p.snapshot.state === "playing") {
    clips.shift()!.end();
    await flush();
  }
  expect(p.snapshot.state).toBe("ended");
  expect(played.join("")).toBe(text);
});
it("manual retry resumes the failed piece rather than replaying successful pieces", async () => {
  const a = clip(),
    b = clip();
  const request = vi
    .fn()
    .mockRejectedValueOnce(long())
    .mockResolvedValueOnce(a)
    .mockRejectedValueOnce(new NarrationError("network"))
    .mockResolvedValueOnce(b);
  const p = new CloudPlayer(request, splitSsmlForRetry);
  p.start(["<speak><s>一。</s><s>二。</s></speak>"]);
  await flush();
  a.end();
  await flush();
  expect(p.snapshot.state).toBe("error");
  p.retry();
  await flush();
  expect(request.mock.calls.at(-1)?.[0]).toBe("<speak><s>二。</s></speak>");
  b.end();
  expect(p.snapshot.completed).toBe(1);
  expect(a.play).toHaveBeenCalledOnce();
});
it("restart cancels the old recovery and does not corrupt the new request", async () => {
  let reject!: (e: unknown) => void;
  const a = clip();
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Clip>((_, r) => {
          reject = r;
        }),
    )
    .mockResolvedValue(a);
  const p = new CloudPlayer(request, splitSsmlForRetry);
  p.start(ssmlChunks("古い文章".repeat(50)));
  await flush();
  p.start(["new"]);
  reject(long());
  await flush();
  expect(request).toHaveBeenCalledTimes(2);
  expect(p.snapshot.state).toBe("playing");
  a.end();
  expect(p.snapshot.state).toBe("ended");
});
it("stops at the total request budget even when individual pieces succeed", async () => {
  const clips: ReturnType<typeof clip>[] = [];
  const request = vi
    .fn()
    .mockRejectedValueOnce(long())
    .mockImplementation(async () => {
      const c = clip();
      clips.push(c);
      return c;
    });
  const p = new CloudPlayer(request, splitSsmlForRetry);
  p.start(["<speak>" + "<s>あ。</s>".repeat(40) + "</speak>"]);
  await flush();
  while (p.snapshot.state === "playing") {
    clips.shift()!.end();
    await flush();
  }
  expect(request).toHaveBeenCalledTimes(32);
  expect(p.snapshot.state).toBe("error");
  expect(p.snapshot.completed).toBe(0);
});
