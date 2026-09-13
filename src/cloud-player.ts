import {
  initialSnapshot,
  safeRate,
  type Player,
  type Snapshot,
} from "./player";
export interface Clip {
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  setRate(rate: number): void;
  onEnd(callback: () => void): void;
  onError(callback: () => void): void;
}
/** No request cancellation assumption: each response and event belongs to a generation. */
export class CloudPlayer implements Player {
  snapshot = initialSnapshot();
  onChange: Player["onChange"] = () => {};
  private generation = 0;
  private chunks: string[] = [];
  private index = 0;
  private clip: Clip | null = null;
  private paused = false;
  private rate = 1;
  constructor(
    private readonly synthesize: (content: string) => Promise<Clip>,
  ) {}
  private update(state: Snapshot["state"], message = "") {
    this.snapshot = {
      state,
      completed: this.index,
      total: this.chunks.length,
      message,
    };
    this.onChange(this.snapshot);
  }
  start(chunks: string[]): void {
    this.stop();
    this.chunks = chunks;
    this.index = 0;
    const id = this.generation;
    void this.next(id);
  }
  private async next(id: number): Promise<void> {
    if (id !== this.generation) return;
    if (this.index >= this.chunks.length) {
      this.update("ended");
      return;
    }
    const content = this.chunks[this.index];
    if (content === undefined) return;
    this.update(this.paused ? "paused" : "loading");
    try {
      const clip = await this.synthesize(content);
      if (id !== this.generation) {
        clip.stop();
        return;
      }
      this.clip = clip;
      clip.setRate(this.rate);
      clip.onEnd(() => {
        if (id !== this.generation || this.clip !== clip) return;
        this.clip = null;
        clip.stop();
        this.index++;
        void this.next(id);
      });
      clip.onError(() => {
        if (id !== this.generation || this.clip !== clip) return;
        this.clip = null;
        clip.stop();
        this.update("error", "音声を再生できませんでした。");
      });
      if (!this.paused) await this.play(id, clip);
    } catch (error: unknown) {
      if (id === this.generation)
        this.update(
          "error",
          error instanceof NarrationError
            ? error.message
            : "音声の取得に失敗しました。接続を確認してください。",
        );
    }
  }
  private async play(id: number, clip: Clip): Promise<void> {
    try {
      await clip.play();
      if (id === this.generation && this.clip === clip && !this.paused)
        this.update("playing");
    } catch {
      if (id === this.generation && this.clip === clip) {
        this.paused = true;
        this.update("paused", "再開ボタンを押すと音声を再生します。");
      }
    }
  }
  pause(): void {
    if (!["playing", "loading"].includes(this.snapshot.state)) return;
    this.paused = true;
    this.clip?.pause();
    this.update("paused");
  }
  resume(): void {
    if (this.snapshot.state !== "paused") return;
    this.paused = false;
    if (this.clip) void this.play(this.generation, this.clip);
    else this.update("loading");
  }
  stop(): void {
    this.generation++;
    this.clip?.stop();
    this.clip = null;
    this.paused = false;
    this.chunks = [];
    this.index = 0;
    this.update("idle");
  }
  setRate(rate: number): void {
    this.rate = safeRate(rate);
    this.clip?.setRate(this.rate);
  }
}
/** Only application-owned, sanitized messages may cross the UI boundary. */
export class NarrationError extends Error {}
