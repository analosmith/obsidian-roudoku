export type PlayState =
  "idle" | "loading" | "playing" | "paused" | "ended" | "error";
export interface Snapshot {
  state: PlayState;
  completed: number;
  total: number;
  message: string;
}
export interface Player {
  readonly snapshot: Snapshot;
  onChange: (snapshot: Snapshot) => void;
  start(chunks: string[]): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: number): void;
}
export const initialSnapshot = (): Snapshot => ({
  state: "idle",
  completed: 0,
  total: 0,
  message: "",
});
export const safeRate = (value: number): number =>
  [0.75, 1, 1.25, 1.5].includes(value) ? value : 1;
