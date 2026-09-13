import { ItemView, Setting, setIcon, type WorkspaceLeaf } from "obsidian";
import type Roudoku from "./main";
import type { SessionSnapshot } from "./session";

export const PLAYER_VIEW = "roudoku-player";
const labels = {
  idle: "ノートを選んで再生",
  loading: "音声を準備中",
  playing: "再生中",
  paused: "一時停止中",
  ended: "読み終わりました",
  error: "再生できませんでした",
};
function iconButton(
  parent: HTMLElement,
  icon: string,
  label: string,
  action: () => void,
): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: "roudoku-icon",
    attr: { "aria-label": label, title: label },
  });
  setIcon(button, icon);
  button.addEventListener("click", action);
  return button;
}
/** Shared controls update in place, keeping keyboard focus and touch targets stable. */
export function mountControls(
  el: HTMLElement,
  plugin: Roudoku,
  compact: boolean,
): () => void {
  el.addClass("roudoku", compact ? "roudoku-mini" : "roudoku-panel");
  const heading = el.createEl(compact ? "button" : "div", {
    cls: "roudoku-track",
  });
  if (compact) {
    heading.setAttribute("aria-label", "朗読プレイヤーを開く");
    heading.addEventListener("click", () => plugin.openPlayer());
  }
  const title = heading.createDiv({ cls: "roudoku-title" });
  const status = heading.createDiv({
    cls: "roudoku-muted",
    attr: { role: "status", "aria-live": "polite" },
  });
  const progress = el.createEl("progress", {
    cls: "roudoku-progress",
    attr: { "aria-label": "読み終えた区間の割合", max: "1", value: "0" },
  });
  const transport = el.createDiv({ cls: "roudoku-transport" });
  const previous = compact
    ? null
    : iconButton(transport, "skip-back", "前の区間から再生", () =>
        plugin.session.skip(-1),
      );
  const play = iconButton(transport, "play", "再生", () => {
    if (plugin.session.snapshot.state === "idle") plugin.readCurrentNote();
    else plugin.session.toggle();
  });
  play.addClass("roudoku-play");
  const next = compact
    ? null
    : iconButton(transport, "skip-forward", "次の区間から再生", () =>
        plugin.session.skip(1),
      );
  const stop = iconButton(
    transport,
    "square",
    "停止してプレイヤーを片づける",
    () => plugin.session.stop(),
  );
  const speed = transport.createEl("select", {
    cls: "roudoku-speed",
    attr: { "aria-label": "再生速度", title: "再生速度" },
  });
  for (const value of [0.75, 1, 1.25, 1.5])
    speed.createEl("option", { value: String(value), text: `${value}×` });
  speed.value = String(plugin.settings.speed);
  speed.addEventListener("change", () =>
    plugin.changeRate(Number(speed.value)),
  );
  const message = compact
    ? null
    : el.createEl("p", { cls: "roudoku-muted", attr: { role: "status" } });
  const update = (s: SessionSnapshot) => {
    if (compact) el.toggleClass("is-hidden", s.state === "idle");
    title.setText(s.title || "朗読");
    status.setText(
      s.total
        ? `${s.provider} · ${labels[s.state]} · ${s.completed}/${s.total}区間`
        : labels[s.state],
    );
    progress.max = s.total || 1;
    progress.value = s.completed;
    const playing = s.state === "playing" || s.state === "loading";
    setIcon(play, playing ? "pause" : "play");
    const label = playing
      ? "一時停止"
      : s.state === "paused"
        ? "再開"
        : s.state === "idle"
          ? "このノートを再生"
          : "先頭から再生";
    play.setAttribute("aria-label", label);
    play.title = label;
    stop.disabled = s.state === "idle";
    if (previous) previous.disabled = !s.total || s.completed === 0;
    if (next) next.disabled = !s.total || s.completed >= s.total - 1;
    speed.value = String(plugin.settings.speed);
    message?.setText(s.message);
  };
  return plugin.session.subscribe(update);
}

export class RoudokuPlayerView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: Roudoku,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return PLAYER_VIEW;
  }
  getDisplayText(): string {
    return "朗読プレイヤー";
  }
  getIcon(): string {
    return "audio-lines";
  }
  async onOpen(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    el.addClass("roudoku");
    this.unsubscribe = mountControls(el.createDiv(), this.plugin, false);
    new Setting(el).setName("開いているノート").addButton((b) =>
      b
        .setButtonText("読み上げる")
        .setCta()
        .onClick(() => this.plugin.readCurrentNote()),
    );
    new Setting(el)
      .setName("音声")
      .setDesc("変更は次の再生から適用します。")
      .addDropdown((d) =>
        d
          .addOptions({ system: "標準音声", google: "Google Cloud" })
          .setValue(this.plugin.settings.provider)
          .onChange((value) => {
            this.plugin.settings.provider =
              value === "google" ? "google" : "system";
            this.plugin.persist();
          }),
      );
    el.createEl("p", {
      cls: "roudoku-muted",
      text: "閉じても再生は続きます。下部バーのノート名を押すと、この画面に戻れます。",
    });
    el.createEl("p", {
      cls: "roudoku-muted",
      text: "進捗は読み終えた区間数です。区間送りはその区間から再生します。Googleでは再合成のAPI料金が発生します。",
    });
    new Setting(el)
      .setName("接続できないとき")
      .addButton((b) =>
        b
          .setButtonText("標準音声で読み直す")
          .onClick(() => this.plugin.replayWithSystem()),
      );
  }
  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }
}
