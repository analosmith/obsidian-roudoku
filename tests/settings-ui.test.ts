import { beforeEach, expect, it, vi } from "vitest";
import type { App, Setting, SettingDefinitionRender } from "obsidian";
const state = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("obsidian", () => {
  class SettingMock {
    name = "";
    desc = "";
    change?: (value: string) => void;
    click?: () => void;
    constructor(_: unknown) {
      state.rows.push(this);
    }
    setName(value: string) {
      this.name = value;
      return this;
    }
    setDesc(value: string) {
      this.desc = value;
      return this;
    }
    setHeading() {
      return this;
    }
    addDropdown(callback: (d: unknown) => void) {
      const d = {
        addOption: () => d,
        setValue: () => d,
        onChange: (fn: (v: string) => void) => {
          this.change = fn;
          return d;
        },
      };
      callback(d);
      return this;
    }
    addButton(callback: (b: unknown) => void) {
      const b = {
        setButtonText: () => b,
        setDisabled: () => b,
        onClick: (fn: () => void) => {
          this.click = fn;
          return b;
        },
      };
      callback(b);
      return this;
    }
  }
  return {
    Plugin: class {},
    ItemView: class {},
    PluginSettingTab: class {
      containerEl = { empty() {}, addClass() {} };
      constructor(public app: unknown) {}
    },
    Setting: SettingMock,
    apiVersion: "1.13.7",
    Platform: { isMobile: false },
  };
});
import Roudoku, { RoudokuSettings } from "../src/main";
import { defaults } from "../src/settings";
import { Setting as SettingClass } from "obsidian";
beforeEach(() => {
  state.rows.length = 0;
  vi.stubGlobal("window", {});
});
function create() {
  const plugin = {
    settings: { ...defaults },
    manifest: { version: "0.0.7" },
    persist: vi.fn(),
    openPlayer: vi.fn(),
    startText: vi.fn(),
  };
  const tab = new RoudokuSettings({} as App, plugin as unknown as Roudoku);
  return { plugin, tab };
}
it("indexes settings without reading secrets, building UI or calling APIs", () => {
  const { tab } = create();
  const defs = tab.getSettingDefinitions();
  expect(defs.map((d) => ("name" in d ? d.name : ""))).toContain(
    "GoogleのAPIキー",
  );
  expect(defs).toHaveLength(7);
  expect(state.rows).toHaveLength(0);
});
it("renders the same searchable rows in legacy display and keeps controls working", () => {
  const { tab, plugin } = create();
  tab.display();
  expect(state.rows.map((r) => r.name)).toEqual(
    tab.getSettingDefinitions().map((d) => ("name" in d ? d.name : "")),
  );
  state.rows
    .find((r) => r.name === "Googleの音声")
    .change("ja-JP-Chirp3-HD-Puck");
  expect(plugin.settings.googleVoice).toBe("ja-JP-Chirp3-HD-Puck");
  expect(plugin.persist).toHaveBeenCalledOnce();
  state.rows.find((r) => r.name === "プレイヤー").click();
  expect(plugin.openPlayer).toHaveBeenCalledOnce();
  expect(state.rows.find((r) => r.name === "GoogleのAPIキー").desc).toContain(
    "平文保存には対応していません",
  );
});
it("renders modern definitions without relying on the legacy container", () => {
  const { tab } = create();
  for (const def of tab.getSettingDefinitions() as SettingDefinitionRender[]) {
    def.render(new SettingClass({} as HTMLElement) as Setting, {} as never);
  }
  expect(state.rows).toHaveLength(7);
});
