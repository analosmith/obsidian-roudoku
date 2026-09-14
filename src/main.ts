import {
  Plugin,
  PluginSettingTab,
  Setting,
  SecretComponent,
  TFile,
  type WorkspaceLeaf,
  MarkdownView,
  Notice,
  requestUrl,
  apiVersion,
  Platform,
  type App,
  type SettingDefinitionItem,
} from "obsidian";
import {
  chunkText,
  markdownToText,
  ssmlChunks,
  splitSsmlForRetry,
} from "./text";
import { CloudPlayer } from "./cloud-player";
import { SystemPlayer, type SpeechPort } from "./system-player";
import { audioClip, synthesizeGoogle, GOOGLE_VOICES } from "./google";
import {
  defaults,
  parseSettings,
  loadGoogleKey,
  type Settings,
} from "./settings";
import { safeRate, type Player } from "./player";
import { PlaybackSession } from "./session";
import { PLAYER_VIEW, RoudokuPlayerView, mountControls } from "./player-view";

const SAMPLE =
  "これは朗読の動作確認です。日本語の文章を、句読点ごとに区切って読み上げます。\n「一時停止」を押した後、「再開」で続きを聴けるか確認してください。\n次に、速度を一・二五倍に変更してみましょう。長い文章も、最後まで途切れずに聴けることを目指しています。";
function speechPort(): SpeechPort {
  const synth = window.speechSynthesis;
  return {
    speak(text, rate, end, error) {
      if (!synth) throw new Error("Speech unavailable");
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ja-JP";
      utterance.rate = rate;
      const voices = synth.getVoices().filter((v) => v.lang.startsWith("ja"));
      const voice = voices.find((v) => v.localService) ?? voices[0];
      if (voice) utterance.voice = voice;
      utterance.onend = end;
      utterance.onerror = () => error();
      synth.speak(utterance);
    },
    pause: () => synth?.pause(),
    resume: () => synth?.resume(),
    cancel: () => synth?.cancel(),
  };
}
export default class Roudoku extends Plugin {
  settings: Settings = { ...defaults };
  readonly session = new PlaybackSession();
  private saveQueue: Promise<void> = Promise.resolve();
  private opening: Promise<WorkspaceLeaf | null> | null = null;
  private unloaded = false;
  private noteFile: TFile | null = null;
  private noteText = "";
  private noteReady = false;
  private noteRevision = 0;
  private lastText = "";
  private lastTitle = "";
  async onload(): Promise<void> {
    this.settings = parseSettings((await this.loadData()) as unknown);
    this.registerView(PLAYER_VIEW, (leaf) => new RoudokuPlayerView(leaf, this));
    this.addSettingTab(new RoudokuSettings(this.app, this));
    this.addRibbonIcon("book-open", "このノートを読み上げ", () =>
      this.readCurrentNote(),
    );
    this.addRibbonIcon("audio-lines", "朗読プレイヤーを開く", () =>
      this.openPlayer(),
    );
    this.addCommand({
      id: "open-player",
      name: "プレイヤーを開く",
      callback: () => this.openPlayer(),
    });
    this.addCommand({
      id: "read-note",
      name: "このノートを読み上げ",
      callback: () => this.readCurrentNote(),
    });
    this.addCommand({
      id: "stop",
      name: "読み上げを停止",
      callback: () => this.session.stop(),
    });
    this.addCommand({
      id: "toggle-playback",
      name: "一時停止・再開",
      callback: () => this.session.toggle(),
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) void this.prepareNote(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file === this.noteFile && file instanceof TFile)
          void this.prepareNote(file);
      }),
    );
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      const file = this.app.workspace.getActiveFile();
      if (file) void this.prepareNote(file);
      void this.ensurePlayer().catch(
        () =>
          new Notice(
            "プレイヤーを配置できませんでした。コマンドから開いてください。",
          ),
      );
      const mini = this.app.workspace.containerEl.createDiv();
      const unsubscribe = mountControls(mini, this, true);
      const workspace = this.app.workspace.containerEl;
      const unsubscribeLayout = this.session.subscribe((snapshot) => {
        workspace.toggleClass("roudoku-has-mini", snapshot.state !== "idle");
      });
      this.register(() => {
        unsubscribe();
        unsubscribeLayout();
        workspace.removeClass("roudoku-has-mini");
        mini.remove();
      });
    });
  }
  onunload(): void {
    this.unloaded = true;
    this.noteRevision++;
    this.session.stop();
  }
  private async ensurePlayer(): Promise<WorkspaceLeaf | null> {
    if (this.unloaded) return null;
    const existing = this.app.workspace.getLeavesOfType(PLAYER_VIEW)[0];
    if (existing) return existing;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: PLAYER_VIEW, active: false });
      return leaf;
    })();
    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }
  openPlayer(): void {
    void this.ensurePlayer()
      .then(async (leaf) => {
        if (leaf && !this.unloaded) await this.app.workspace.revealLeaf(leaf);
      })
      .catch(
        () =>
          new Notice("プレイヤーを開けませんでした。もう一度お試しください。"),
      );
  }
  private async prepareNote(file: TFile): Promise<void> {
    if (file.extension !== "md") {
      this.noteRevision++;
      this.noteFile = null;
      this.noteReady = false;
      return;
    }
    const revision = ++this.noteRevision;
    this.noteFile = file;
    this.noteReady = false;
    try {
      const text = markdownToText(await this.app.vault.cachedRead(file));
      if (revision !== this.noteRevision || this.unloaded) return;
      this.noteText = text;
      this.noteReady = true;
    } catch {
      if (revision === this.noteRevision) {
        this.noteText = "";
        this.noteReady = false;
      }
    }
  }
  readCurrentNote(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file && view.getMode() === "source") {
      this.startText(
        markdownToText(view.editor.getValue()),
        view.file.basename,
      );
      return;
    }
    const active = this.app.workspace.getActiveFile();
    if (active && active !== this.noteFile) {
      void this.prepareNote(active);
      new Notice("本文を準備しています。もう一度、再生を押してください。");
      return;
    }
    if (!this.noteFile) {
      new Notice("読み上げるノートを開いてください。");
      return;
    }
    if (!this.noteReady) {
      void this.prepareNote(this.noteFile);
      new Notice("本文を準備しています。もう一度、再生を押してください。");
      return;
    }
    this.startText(this.noteText, this.noteFile.basename);
  }
  replayWithSystem(): void {
    if (this.lastText) this.startText(this.lastText, this.lastTitle, true);
    else new Notice("先にノートを再生してください。");
  }
  changeRate(rate: number): void {
    this.settings.speed = safeRate(rate);
    this.session.setRate(this.settings.speed);
    this.persist();
  }
  saveSettings(): Promise<void> {
    const snapshot = parseSettings(this.settings);
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(() => this.saveData(snapshot));
    return this.saveQueue;
  }
  persist(): void {
    void this.saveSettings().catch(
      () =>
        new Notice("設定を保存できませんでした。空き容量を確認してください。"),
    );
  }
  startText(text: string, title: string, forceSystem = false): void {
    if (!text.trim()) {
      new Notice("読み上げる本文がありません。");
      return;
    }
    const credential = loadGoogleKey(
      this.app.secretStorage,
      this.settings.googleSecretName,
    );
    let provider = this.settings.provider;
    if (
      forceSystem ||
      (provider === "google" && (!credential.key || !navigator.onLine))
    ) {
      if (!forceSystem)
        new Notice(
          !navigator.onLine
            ? "オフラインのため標準音声を使います。"
            : "Googleのキーを取得できないため標準音声を使います。",
        );
      provider = "system";
    }
    this.lastText = text;
    this.lastTitle = title;
    let player: Player;
    let chunks: string[];
    if (provider === "google" && credential.key) {
      const key = credential.key,
        voice = this.settings.googleVoice;
      player = new CloudPlayer(
        async (content) =>
          audioClip(
            await synthesizeGoogle(
              content,
              key,
              voice,
              async (body, apiKey) => {
                const response = await requestUrl({
                  url: "https://texttospeech.googleapis.com/v1/text:synthesize",
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": apiKey,
                  },
                  body: JSON.stringify(body),
                  throw: false,
                });
                return {
                  status: response.status,
                  json: response.json as unknown,
                };
              },
            ),
          ),
        splitSsmlForRetry,
      );
      chunks = ssmlChunks(text, 1800);
    } else {
      player = new SystemPlayer(speechPort());
      chunks = chunkText(text, 180);
    }
    const label = provider === "google" ? "Google Cloud" : "標準音声";
    this.session.start(player, chunks, title, label, this.settings.speed);
  }
}
type SettingsRow = {
  name: string;
  desc?: string;
  aliases?: string[];
  render: (setting: Setting) => void;
};
export class RoudokuSettings extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: Roudoku,
  ) {
    super(app, plugin);
  }
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.rows();
  }
  // Obsidian before 1.13 calls display instead of the declarative API.
  display(): void {
    this.containerEl.empty();
    this.containerEl.addClass("roudoku");
    for (const row of this.rows()) {
      row.render(
        new Setting(this.containerEl).setName(row.name).setDesc(row.desc ?? ""),
      );
    }
  }
  private rows(): SettingsRow[] {
    return [
      {
        name: `朗読 ${this.plugin.manifest.version}`,
        desc: "対応するクラウド音声サービスはGoogle Cloudのみです。ご自身のAPIキーを登録して利用します。Googleでの読み上げは本文をGoogleへ送信し、API利用料金が発生します。キー未登録・オフライン時には、端末の標準音声を代替として利用できます。",
        render: (setting) => {
          setting.setHeading();
        },
      },
      {
        name: "Googleの音声",
        aliases: ["voice", "Google Cloud", "Chirp"],
        render: (setting) => {
          setting.addDropdown((d) => {
            for (const name of GOOGLE_VOICES)
              d.addOption(name, name.replace("ja-JP-Chirp3-HD-", ""));
            d.setValue(this.plugin.settings.googleVoice).onChange((value) => {
              this.plugin.settings.googleVoice = value;
              this.plugin.persist();
            });
          });
        },
      },
      {
        name: "GoogleのAPIキー",
        aliases: ["API key", "SecretStorage"],
        desc: "SecretStorageのキーを作成・選択します。キー本体は端末ごとに登録します。",
        render: (setting) => {
          if (
            loadGoogleKey(
              this.app.secretStorage,
              this.plugin.settings.googleSecretName,
            ).state === "unavailable"
          ) {
            setting.setDesc(
              "SecretStorageを使えません。APIキーの平文保存には対応していません。標準音声を使用できます。",
            );
            return;
          }
          setting.addComponent((container) =>
            new SecretComponent(this.app, container)
              .setValue(this.plugin.settings.googleSecretName)
              .onChange((value) => {
                this.plugin.settings.googleSecretName = value ?? "";
                this.plugin.persist();
              }),
          );
        },
      },
      {
        name: "キーの接続確認",
        aliases: ["connection", "API"],
        desc: "Googleの音声一覧を取得します。文章の合成は行いません。",
        render: (setting) => {
          setting.addButton((b) =>
            b.setButtonText("接続確認").onClick(async () => {
              b.setDisabled(true);
              try {
                const current = loadGoogleKey(
                  this.app.secretStorage,
                  this.plugin.settings.googleSecretName,
                );
                if (!current.key) {
                  new Notice("Googleのキーを登録・選択してください。");
                  return;
                }
                const response = await requestUrl({
                  url: "https://texttospeech.googleapis.com/v1/voices?languageCode=ja-JP",
                  headers: { "X-Goog-Api-Key": current.key },
                  throw: false,
                });
                new Notice(
                  response.status === 200
                    ? "音声一覧へ接続できました。合成の可否は設定の例文再生で確認してください。"
                    : `接続できませんでした（HTTP ${response.status}）。キーと権限を確認してください。`,
                );
              } catch {
                new Notice(
                  "接続できませんでした。ネットワークを確認してください。",
                );
              } finally {
                b.setDisabled(false);
              }
            }),
          );
        },
      },
      {
        name: "プレイヤー",
        aliases: ["player"],
        render: (setting) => {
          setting.addButton((b) =>
            b.setButtonText("開く").onClick(() => this.plugin.openPlayer()),
          );
        },
      },
      {
        name: "動作確認",
        aliases: ["sample", "再生"],
        desc: "Google選択時は文章を送信し、API利用料金が発生します。",
        render: (setting) => {
          setting.addButton((b) =>
            b
              .setButtonText("例文を再生")
              .onClick(() => this.plugin.startText(SAMPLE, "動作確認の例文")),
          );
        },
      },
      {
        name: "端末診断",
        aliases: ["diagnostic", "SecretStorage"],
        desc: "キーの値やノート本文は表示しません。再起動後も取得成功になるか確認します。",
        render: (setting) => {
          const update = () => {
            const key = loadGoogleKey(
              this.app.secretStorage,
              this.plugin.settings.googleSecretName,
            );
            const states = {
              available: "取得成功",
              missing: "未登録",
              unavailable: "利用不可",
              error: "取得失敗",
            };
            setting.setDesc(
              `Obsidian ${apiVersion} / ${Platform.isMobile ? "モバイル" : "デスクトップ"} / SecretStorage: ${states[key.state]} / 日本語音声: ${window.speechSynthesis?.getVoices().filter((v) => v.lang.startsWith("ja")).length ?? 0}件。キーの値やノート本文は表示しません。`,
            );
          };
          setting.addButton((b) =>
            b.setButtonText("診断を更新").onClick(update),
          );
          update();
        },
      },
    ];
  }
}
