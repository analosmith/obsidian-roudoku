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
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
    expect(make).toHaveBeenCalledTimes(2);
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
