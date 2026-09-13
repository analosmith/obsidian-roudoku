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
  ): void {
    this.stop();
    this.player = player;
    this.chunks = chunks;
    this.snapshot = {
      ...initialSnapshot(),
      title,
      provider,
      rate: safeRate(rate),
    };
    this.playFrom(0);
  }
  private playFrom(offset: number): void {
    const player = this.player;
    if (!player) return;
    const generation = ++this.generation;
    player.onChange = (s) => {
      if (generation !== this.generation) return;
      this.snapshot = {
        ...this.snapshot,
        ...s,
        completed: offset + s.completed,
        total: this.chunks.length,
      };
      this.emit();
    };
    player.setRate(this.snapshot.rate);
    player.start(this.chunks.slice(offset));
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
    else if (this.player) this.playFrom(0);
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
    this.player = null;
    this.chunks = [];
    this.snapshot = {
      ...initialSnapshot(),
      title: "",
      provider: "",
      rate: this.snapshot.rate,
    };
    this.emit();
  }
}
