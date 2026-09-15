import {
  initialSnapshot,
  safeRate,
  type Player,
  type Snapshot,
} from "./player";
export interface SessionSnapshot extends Snapshot {
  title: string;
  provider: string;
  rate: number;
}
/** The plugin owns this session; views only subscribe and may close at any time. */
export class PlaybackSession {
  snapshot: SessionSnapshot = {
    ...initialSnapshot(),
    title: "",
    provider: "",
    rate: 1,
  };
  segments: readonly string[] = [];
  private resumeIndex = 0;
  get hasContent(): boolean {
    return this.chunks.length > 0;
  }
  private player: Player | null = null;
  private chunks: string[] = [];
  private generation = 0;
  private listeners = new Set<(s: SessionSnapshot) => void>();
  subscribe(listener: (s: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }
  start(
    player: Player,
    chunks: string[],
    title: string,
    provider: string,
    rate: number,
    segments: string[] = chunks,
    autoplay = true,
  ): void {
    this.stop();
    this.player = player;
    this.chunks = chunks;
    this.segments = segments;
    this.resumeIndex = 0;
    this.snapshot = {
      ...initialSnapshot(),
      title,
      provider,
      rate: safeRate(rate),
    };
    if (autoplay) this.playFrom(0);
    else {
      this.snapshot.total = chunks.length;
      this.emit();
    }
  }
  private playFrom(offset: number): void {
    const player = this.player;
    if (
      !player ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset >= this.chunks.length
    )
      return;
    const generation = ++this.generation;
    player.onChange = (s) => {
      if (generation !== this.generation) return;
      this.snapshot = {
        ...this.snapshot,
        ...s,
        completed: offset + s.completed,
        total: this.chunks.length,
      };
      this.resumeIndex = Math.min(offset + s.completed, this.chunks.length - 1);
      this.emit();
    };
    player.setRate(this.snapshot.rate);
    player.start(this.chunks.slice(offset));
  }
  seek(index: number): void {
    this.playFrom(index);
  }
  skip(delta: number): void {
    const current = Math.min(this.snapshot.completed, this.chunks.length - 1);
    const next = current + delta;
    if (next >= 0 && next < this.chunks.length) this.playFrom(next);
  }
  toggle(): void {
    if (this.snapshot.state === "paused") this.player?.resume();
    else if (["playing", "loading"].includes(this.snapshot.state))
      this.player?.pause();
    else if (this.snapshot.state === "error" && this.player?.retry)
      this.player.retry();
    else if (this.player)
      this.playFrom(this.snapshot.state === "ended" ? 0 : this.resumeIndex);
  }
  setRate(rate: number): void {
    this.snapshot = { ...this.snapshot, rate: safeRate(rate) };
    this.player?.setRate(this.snapshot.rate);
    this.emit();
  }
  stop(): void {
    ++this.generation;
    if (this.player) {
      this.player.onChange = () => {};
      this.player.stop();
    }
    this.snapshot = {
      ...this.snapshot,
      state: "idle",
      message: "",
      completed: this.resumeIndex,
    };
    this.emit();
  }
}
