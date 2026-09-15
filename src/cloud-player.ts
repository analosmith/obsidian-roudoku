import {
  initialSnapshot,
  safeRate,
  type Player,
  type Snapshot,
} from "./player";
type Budget = { attempts: number; ms: number };
type Prepared = { clip: Clip } | { error: unknown };
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
  private parts: { content: string; depth: number }[] = [];
  private budget: Budget = { attempts: 0, ms: 0 };
  private ahead: {
    content: string;
    index: number;
    part?: { content: string; depth: number };
    budget: Budget;
    result: Promise<Prepared>;
    clip?: Clip;
  } | null = null;
  private recovering = false;
  private pending = false;
  private cancelWait = new Set<() => void>();
  constructor(
    private readonly synthesize: (content: string) => Promise<Clip>,
    private readonly split?: (content: string) => string[],
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
    this.prepareSegment();
    const id = this.generation;
    void this.next(id);
  }
  private prepareSegment(): void {
    const content = this.chunks[this.index];
    this.parts = content === undefined ? [] : [{ content, depth: 0 }];
    this.budget = { attempts: 0, ms: 0 };
    this.recovering = false;
  }
  /** Bound waiting without assuming transport cancellation; dispose late clips. */
  private request(
    content: string,
    id: number,
    budget = this.budget,
  ): Promise<Clip> {
    const remaining = 60_000 - budget.ms;
    if (budget.attempts >= 32 || remaining <= 0)
      return Promise.reject(
        new NarrationError(
          "自動再試行の上限に達しました。現在位置から再試行できます。",
        ),
      );
    budget.attempts++;
    const start = Date.now();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        settled = true;
        window.clearTimeout(timer);
        budget.ms += Date.now() - start;
        this.cancelWait.delete(cancel);
      };
      const timer = window.setTimeout(() => {
        finish();
        reject(
          new NarrationError(
            "音声の取得が時間内に完了しませんでした。現在位置から再試行できます。",
          ),
        );
      }, remaining);
      const cancel = () => {
        finish();
        reject(new Error("Cancelled"));
      };
      this.cancelWait.add(cancel);
      void (async () => {
        if (settled || id !== this.generation) throw new Error("Cancelled");
        return this.synthesize(content);
      })().then(
        (clip) => {
          if (settled || id !== this.generation) {
            clip.stop();
            return;
          }
          finish();
          resolve(clip);
        },
        (error: unknown) => {
          if (settled) return;
          finish();
          reject(
            error instanceof Error
              ? error
              : new NarrationError("音声の取得に失敗しました。"),
          );
        },
      );
    });
  }
  private async next(id: number): Promise<void> {
    if (id !== this.generation) return;
    if (this.index >= this.chunks.length) {
      this.update("ended");
      return;
    }
    const part = this.parts[0];
    if (!part || this.pending) return;
    if (this.paused) {
      this.update("paused");
      return;
    }
    this.update("loading", this.recovering ? "文章を短く分けて再試行中…" : "");
    this.pending = true;
    try {
      const ahead = this.ahead;
      let clip: Clip;
      if (
        ahead &&
        ahead.index === this.index &&
        (ahead.part ? ahead.part === part : ahead.content === part.content)
      ) {
        this.ahead = null;
        this.budget = ahead.budget;
        const result = await ahead.result;
        if ("error" in result) throw result.error;
        clip = result.clip;
      } else {
        clip = await this.request(part.content, id);
      }
      if (id === this.generation) this.pending = false;
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
        this.parts.shift();
        if (!this.parts.length) {
          this.index++;
          this.prepareSegment();
        }
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
      if (id !== this.generation) return;
      this.pending = false;
      if (
        error instanceof NarrationError &&
        error.code === "sentence-too-long" &&
        this.split &&
        part.depth < 4 &&
        this.budget.attempts < 32
      ) {
        const smaller = this.split(part.content);
        if (smaller.length > 1) {
          this.parts.splice(
            0,
            1,
            ...smaller.map((content) => ({ content, depth: part.depth + 1 })),
          );
          this.recovering = true;
          void this.next(id);
          return;
        }
      }
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
      if (id === this.generation && this.clip === clip && !this.paused) {
        this.update("playing");
        this.prefetch(id);
      }
    } catch {
      if (id === this.generation && this.clip === clip) {
        this.paused = true;
        this.update("paused", "再開ボタンを押すと音声を再生します。");
      }
    }
  }
  /** At most one future fragment; errors surface only when playback reaches it. */
  private prefetch(id: number): void {
    if (this.ahead || this.paused || id !== this.generation) return;
    const content = this.parts[1]?.content ?? this.chunks[this.index + 1];
    if (content === undefined) return;
    const budget = this.parts.length > 1 ? this.budget : { attempts: 0, ms: 0 };
    const slot: NonNullable<CloudPlayer["ahead"]> = {
      content,
      index: this.parts.length > 1 ? this.index : this.index + 1,
      part: this.parts[1],
      budget,
      result: Promise.resolve({ error: new Error("Not started") }),
    };
    this.ahead = slot;
    slot.result = this.request(content, id, budget).then(
      (clip): Prepared => {
        if (id !== this.generation) {
          clip.stop();
          return { error: new Error("Cancelled") };
        }
        slot.clip = clip;
        return { clip };
      },
      (error: unknown): Prepared => ({ error }),
    );
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
    else if (!this.pending) void this.next(this.generation);
    else this.update("loading");
  }
  retry(): void {
    if (this.snapshot.state !== "error") return;
    this.budget = { attempts: 0, ms: 0 };
    this.paused = false;
    void this.next(this.generation);
  }
  stop(): void {
    this.generation++;
    for (const cancel of this.cancelWait) cancel();
    this.ahead?.clip?.stop();
    this.ahead = null;
    this.pending = false;
    this.parts = [];
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
export class NarrationError extends Error {
  constructor(
    message: string,
    readonly code?: "sentence-too-long",
  ) {
    super(message);
  }
}
