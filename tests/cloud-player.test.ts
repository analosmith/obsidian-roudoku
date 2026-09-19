import { beforeEach } from "vitest";
import { describe, it, expect, vi } from "vitest";
import { CloudPlayer, type Clip } from "../src/cloud-player";
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
function fakeClip() {
  let end = () => {};
  let error = () => {};
  return {
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    stop: vi.fn(),
    setRate: vi.fn(),
    onEnd: (fn: () => void) => {
      end = fn;
    },
    onError: (fn: () => void) => {
      error = fn;
    },
    end: () => end(),
    error: () => error(),
  };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
describe("cloud session lifecycle", () => {
  it("discards a late response after stop", async () => {
    const d = deferred<Clip>();
    const c = fakeClip();
    const make = vi.fn(() => d.promise);
    const p = new CloudPlayer(make);
    p.start(["one", "two"]);
    p.stop();
    d.resolve(c);
    await flush();
    expect(c.play).not.toHaveBeenCalled();
    expect(c.stop).toHaveBeenCalled();
    expect(make).toHaveBeenCalledTimes(1);
    expect(p.snapshot.state).toBe("idle");
  });
  it("does not autoplay if paused during synthesis", async () => {
    const d = deferred<Clip>();
    const c = fakeClip();
    const p = new CloudPlayer(() => d.promise);
    p.start(["one"]);
    p.pause();
    d.resolve(c);
    await flush();
    expect(c.play).not.toHaveBeenCalled();
    expect(p.snapshot.state).toBe("paused");
    p.resume();
    await flush();
    expect(c.play).toHaveBeenCalledTimes(1);
  });
  it("ignores stale end events after restart", async () => {
    const a = fakeClip(),
      b = fakeClip();
    let i = 0;
    const make = vi.fn(async () => (i++ === 0 ? a : b));
    const p = new CloudPlayer(make);
    p.start(["old", "old2"]);
    await flush();
    p.start(["new"]);
    await flush();
    a.end();
    await flush();
    expect(make).toHaveBeenCalledTimes(3);
    expect(p.snapshot.total).toBe(1);
    expect(p.snapshot.state).toBe("playing");
  });
  it("releases clips and advances exactly once", async () => {
    const c = fakeClip();
    const make = vi.fn(async () => c);
    const p = new CloudPlayer(make);
    p.start(["only"]);
    await flush();
    c.end();
    c.end();
    expect(p.snapshot.state).toBe("ended");
    expect(make).toHaveBeenCalledTimes(1);
    expect(c.stop).toHaveBeenCalled();
  });
  it("turns autoplay rejection into a recoverable pause", async () => {
    const c = fakeClip();
    c.play.mockRejectedValueOnce(new Error("blocked"));
    const p = new CloudPlayer(async () => c);
    p.start(["one"]);
    await flush();
    expect(p.snapshot.state).toBe("paused");
    p.resume();
    await flush();
    expect(p.snapshot.state).toBe("playing");
  });
});

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
});

it("prefetches exactly one clip during playback and consumes it without another request", async () => {
  const clips = [fakeClip(), fakeClip(), fakeClip()];
  const make = vi.fn(async (text: string) => clips[Number(text)]!);
  const p = new CloudPlayer(make);
  p.start(["0", "1", "2"]);
  await flush();
  expect(make.mock.calls.map((c) => c[0])).toEqual(["0", "1"]);
  expect(clips[1]!.play).not.toHaveBeenCalled();
  clips[0]!.end();
  await flush();
  expect(clips[1]!.play).toHaveBeenCalledOnce();
  expect(make.mock.calls.map((c) => c[0])).toEqual(["0", "1", "2"]);
  p.stop();
  expect(clips[2]!.stop).toHaveBeenCalled();
});
it("disposes an in-flight prefetch after stop without autoplay", async () => {
  const a = fakeClip(),
    b = fakeClip(),
    d = deferred<Clip>();
  const p = new CloudPlayer(
    vi.fn().mockResolvedValueOnce(a).mockReturnValueOnce(d.promise),
  );
  p.start(["a", "b"]);
  await flush();
  p.stop();
  d.resolve(b);
  await flush();
  expect(b.stop).toHaveBeenCalled();
  expect(b.play).not.toHaveBeenCalled();
});
it("defers a prefetch error until that segment and allows retry", async () => {
  const a = fakeClip(),
    b = fakeClip();
  const make = vi
    .fn()
    .mockResolvedValueOnce(a)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(b);
  const p = new CloudPlayer(make);
  p.start(["a", "b"]);
  await flush();
  expect(p.snapshot.state).toBe("playing");
  a.end();
  await flush();
  expect(p.snapshot.state).toBe("error");
  p.retry();
  await flush();
  expect(b.play).toHaveBeenCalledOnce();
  p.stop();
});
it("keeps future prefetch separate when retrying identical current text", async () => {
  const a = fakeClip(),
    future = fakeClip(),
    retry = fakeClip();
  const make = vi
    .fn()
    .mockResolvedValueOnce(a)
    .mockResolvedValueOnce(future)
    .mockResolvedValueOnce(retry);
  const p = new CloudPlayer(make);
  p.start(["same", "same"]);
  await flush();
  a.error();
  p.retry();
  await flush();
  expect(retry.play).toHaveBeenCalledOnce();
  expect(future.play).not.toHaveBeenCalled();
  retry.end();
  await flush();
  expect(future.play).toHaveBeenCalledOnce();
  expect(make).toHaveBeenCalledTimes(3);
  p.stop();
});
