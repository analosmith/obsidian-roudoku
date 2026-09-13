import {
  initialSnapshot,
  safeRate,
  type Player,
  type Snapshot,
} from "./player";
export interface SpeechPort {
  speak(
    text: string,
    rate: number,
    onEnd: () => void,
    onError: () => void,
  ): void;
  pause(): void;
  resume(): void;
  cancel(): void;
}
export class SystemPlayer implements Player {
  snapshot = initialSnapshot();
  onChange: Player["onChange"] = () => {};
  private chunks: string[] = [];
  private index = 0;
  private generation = 0;
  private utteranceId = 0;
  private rate = 1;
  private needsStart = false;
  constructor(private readonly speech: SpeechPort) {}
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
    this.speech.resume();
    this.chunks = chunks;
    this.speak();
  }
  private speak(): void {
    const content = this.chunks[this.index];
    if (content === undefined) {
      this.update("ended");
      return;
    }
    this.needsStart = false;
    const gen = this.generation,
      utterance = ++this.utteranceId;
    this.update("playing");
    try {
      this.speech.speak(
        content,
        this.rate,
        () => {
          if (gen !== this.generation || utterance !== this.utteranceId) return;
          this.utteranceId++;
          this.index++;
          if (this.snapshot.state === "paused") {
            this.needsStart = true;
            return;
          }
          this.speak();
        },
        () => {
          if (gen === this.generation && utterance === this.utteranceId)
            this.update(
              "error",
              "標準音声を再生できません。日本語音声の設定を確認してください。",
            );
        },
      );
    } catch {
      this.update("error", "この環境では標準音声を使えません。");
    }
  }
  pause(): void {
    if (this.snapshot.state !== "playing") return;
    this.speech.pause();
    this.update("paused");
  }
  resume(): void {
    if (this.snapshot.state !== "paused") return;
    if (this.needsStart) {
      this.speech.resume();
      this.speak();
    } else {
      this.speech.resume();
      this.update("playing");
    }
  }
  stop(): void {
    this.generation++;
    this.utteranceId++;
    this.speech.cancel();
    this.needsStart = false;
    this.chunks = [];
    this.index = 0;
    this.update("idle");
  }
  setRate(rate: number): void {
    this.rate = safeRate(rate);
    if (this.snapshot.state === "playing") {
      this.utteranceId++;
      this.speech.cancel();
      this.speech.resume();
      this.speak();
    } else if (this.snapshot.state === "paused") {
      this.utteranceId++;
      this.speech.cancel();
      this.needsStart = true;
    }
  }
}
