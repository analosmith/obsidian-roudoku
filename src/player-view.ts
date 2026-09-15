import { ItemView, Setting, setIcon, type WorkspaceLeaf } from "obsidian";
import type Roudoku from "./main";
import type { SessionSnapshot } from "./session";

export const PLAYER_VIEW = "roudoku-player";
const labels = {
  idle: "停止中",
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
    if (!plugin.session.hasContent) plugin.readCurrentNote();
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
          ? plugin.session.hasContent
            ? "この位置から再開"
            : "このノートを再生"
          : s.state === "error" && s.provider === "Google Cloud"
            ? "失敗した位置から再試行"
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
    new Setting(el)
      .setName("開いているノート")
      .addButton((b) =>
        b
          .setButtonText("本文を表示")
          .onClick(() => this.plugin.readCurrentNote(false)),
      )
      .addButton((b) =>
        b
          .setButtonText("読み上げる")
          .setCta()
          .onClick(() => this.plugin.readCurrentNote()),
      );
    const voice = new Setting(el)
      .setName("音声")
      .setDesc("変更後に読み上げるノートへ適用します。");
    const buttons: HTMLButtonElement[] = [];
    const refresh = () =>
      buttons.forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.provider === this.plugin.settings.provider),
        );
      });
    for (const [provider, name] of [
      ["google", "Google Cloud"],
      ["system", "標準音声"],
    ] as const) {
      voice.addButton((b) => {
        b.setButtonText(name).onClick(() => {
          this.plugin.settings.provider = provider;
          this.plugin.persist();
          refresh();
        });
        b.buttonEl.dataset.provider = provider;
        buttons.push(b.buttonEl);
      });
    }
    refresh();
    const transcript = el.createDiv({ cls: "roudoku-transcript" });
    new Setting(transcript).setName("読み上げ本文").setHeading();
    transcript.createEl("p", {
      cls: "roudoku-muted",
      text: "本文の区間を押すと、そこから再生します。停止しても位置は残ります（アプリを閉じるまで）。",
    });
    const navigation = transcript.createDiv({ cls: "roudoku-transcript-nav" });
    const rows = transcript.createDiv();
    let page = 0;
    let currentSegments: readonly string[] | null = null;
    let rowButtons: HTMLButtonElement[] = [];
    const pageSize = 60;
    const render = () => {
      rows.empty();
      const segments = this.plugin.session.segments;
      const offset = page * pageSize;
      rowButtons = segments
        .slice(offset, offset + pageSize)
        .map((text, index) => {
          const button = rows.createEl("button", {
            cls: "roudoku-sentence",
            text: `${offset + index + 1}. ${text}`,
          });
          button.addEventListener("click", () =>
            this.plugin.session.seek(offset + index),
          );
          return button;
        });
      if (!segments.length)
        rows.createEl("p", {
          text: "ノートを読み上げると本文が表示されます。",
        });
      back.disabled = page === 0;
      forward.disabled = offset + pageSize >= segments.length;
      pageLabel.setText(
        segments.length
          ? `${offset + 1}–${Math.min(offset + pageSize, segments.length)} / ${segments.length}`
          : "",
      );
      highlight();
    };
    const highlight = () => {
      const index = this.plugin.session.snapshot.completed;
      rowButtons.forEach((button, i) =>
        button.setAttribute(
          "aria-current",
          String(page * pageSize + i === index),
        ),
      );
    };
    const back = iconButton(navigation, "chevron-left", "前の本文", () => {
      page--;
      render();
    });
    const pageLabel = navigation.createSpan();
    const forward = iconButton(navigation, "chevron-right", "次の本文", () => {
      page++;
      render();
    });
    iconButton(navigation, "locate", "再生位置を表示", () => {
      page = Math.floor(
        Math.min(
          this.plugin.session.snapshot.completed,
          Math.max(0, this.plugin.session.segments.length - 1),
        ) / pageSize,
      );
      render();
      rowButtons
        .find((b) => b.getAttribute("aria-current") === "true")
        ?.scrollIntoView({ block: "nearest" });
    });
    const unsubscribeControls = this.unsubscribe;
    const unsubscribeText = this.plugin.session.subscribe(() => {
      if (currentSegments !== this.plugin.session.segments) {
        currentSegments = this.plugin.session.segments;
        page = 0;
        render();
      } else highlight();
    });
    this.unsubscribe = () => {
      unsubscribeControls?.();
      unsubscribeText();
    };
    el.createEl("p", {
      cls: "roudoku-muted",
      text: "閉じても再生は続きます。下部バーのノート名を押すと、この画面に戻れます。",
    });
    el.createEl("p", {
      cls: "roudoku-muted",
      text: "進捗は読み終えた区間数です。区間送りはその区間から再生します。Googleでは先の1区間を生成します。停止して聴かなかった先読み分や、位置変更後の再合成にもAPI料金が発生します。文の長さで拒否された場合は自動で短く分けて再試行します。",
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
