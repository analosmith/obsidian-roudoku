import { describe, it, expect, vi } from "vitest";
import { PlaybackSession } from "../src/session";
import { initialSnapshot, type Player } from "../src/player";
function fake(): Player {
  const p: Player = {
    snapshot: initialSnapshot(),
    onChange: () => {},
    start: vi.fn((chunks: string[]) =>
      p.onChange({
        state: "playing",
        completed: 0,
        total: chunks.length,
        message: "",
      }),
    ),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setRate: vi.fn(),
  };
  return p;
}
describe("persistent playback session", () => {
  it("keeps playing when a view unsubscribes and restores state to a new view", () => {
    const s = new PlaybackSession(),
      p = fake(),
      listener = vi.fn();
    const close = s.subscribe(listener);
    s.start(p, ["one", "two"], "Note A", "標準音声", 1);
    close();
    listener.mockClear();
    p.onChange({ state: "paused", completed: 1, total: 2, message: "" });
    expect(p.stop).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    const reopened = vi.fn();
    s.subscribe(reopened);
    expect(reopened).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "paused",
        title: "Note A",
        completed: 1,
      }),
    );
  });
  it("ignores callbacks from a replaced note", () => {
    const s = new PlaybackSession(),
      a = fake(),
      b = fake();
    s.start(a, ["old"], "Old", "標準音声", 1);
    const stale = a.onChange;
    s.start(b, ["new", "next"], "New", "標準音声", 1);
    stale({ state: "ended", completed: 1, total: 1, message: "" });
    expect(a.stop).toHaveBeenCalledOnce();
    expect(s.snapshot.title).toBe("New");
    expect(s.snapshot.state).toBe("playing");
  });
  it("skips bounded chunks and preserves progress across restarts", () => {
    const s = new PlaybackSession(),
      p = fake();
    s.start(p, ["a", "b", "c"], "Note", "Google Cloud", 1.25);
    const stale = p.onChange;
    s.skip(1);
    expect(p.start).toHaveBeenLastCalledWith(["b", "c"]);
    stale({ state: "ended", completed: 3, total: 3, message: "" });
    expect(s.snapshot.completed).toBe(1);
    expect(s.snapshot.total).toBe(3);
    s.skip(1);
    s.skip(1);
    expect(s.snapshot.completed).toBe(2);
    expect(p.start).toHaveBeenCalledTimes(3);
    s.skip(-1);
    expect(p.start).toHaveBeenLastCalledWith(["b", "c"]);
  });
  it("stops but retains the note and ignores late events", () => {
    const s = new PlaybackSession(),
      p = fake();
    s.start(p, ["a"], "Note", "標準音声", 1);
    const stale = p.onChange;
    s.stop();
    stale({ state: "playing", completed: 0, total: 1, message: "" });
    expect(s.snapshot.state).toBe("idle");
    expect(s.snapshot.title).toBe("Note");
    s.skip(1);
    expect(p.start).toHaveBeenCalledOnce();
  });
});
it("routes the error play button to the current fragment retry", () => {
  const session = new PlaybackSession(),
    player = fake();
  player.retry = vi.fn();
  session.start(player, ["a", "b"], "Note", "Google Cloud", 1);
  player.onChange({
    state: "error",
    completed: 1,
    total: 2,
    message: "failed",
  });
  session.toggle();
  expect(player.retry).toHaveBeenCalledOnce();
  expect(player.start).toHaveBeenCalledOnce();
  expect(session.snapshot.completed).toBe(1);
});
it("previews without synthesis, seeks and resumes the stopped position", () => {
  const s = new PlaybackSession(),
    p = fake();
  s.start(
    p,
    ["a", "b", "c"],
    "note",
    "Google Cloud",
    1,
    ["甲", "乙", "丙"],
    false,
  );
  expect(p.start).not.toHaveBeenCalled();
  expect(s.segments).toEqual(["甲", "乙", "丙"]);
  s.seek(1);
  expect(p.start).toHaveBeenLastCalledWith(["b", "c"]);
  s.stop();
  s.toggle();
  expect(p.start).toHaveBeenLastCalledWith(["b", "c"]);
  const count = vi.mocked(p.start).mock.calls.length;
  s.seek(-1);
  s.seek(3);
  s.seek(NaN);
  s.seek(1.5);
  expect(p.start).toHaveBeenCalledTimes(count);
});
