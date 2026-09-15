# 朗読 (Roudoku)

Listen to Japanese notes in Obsidian with Google Cloud Text-to-Speech.
A sidebar player and a compact playback bar let you keep reading while you listen.

**Google Cloud is the only supported cloud speech provider.** Device speech is available as a fallback. The plugin is free; Google Cloud API usage is billed to your own Google Cloud project.

## Features

- Read the current Markdown note with Japanese sentence splitting.
- Right-sidebar player and compact playback bar sharing the same session.
- Play, pause, resume, stop, previous/next segment, and 0.75× / 1× / 1.25× / 1.5× speed.
- Continue playback when the player pane is closed.
- Google Cloud Japanese Chirp 3 HD voices with SSML input.
- API credentials stored using Obsidian SecretStorage.

## Requirements and installation

Obsidian **1.11.5 or later** is required. Development testing used Obsidian 1.13.7 on Mac and iPhone. Android and iPad have not been tested.

Install **Roudoku** from [the community plugin listing](https://community.obsidian.md/plugins/roudoku), or use the manual steps below.

1. Download `main.js`, `manifest.json`, and `styles.css` from the GitHub Release.
2. Create `<your-vault>/.obsidian/plugins/roudoku/` and put the three files there.
3. Reload Obsidian and enable **Roudoku** in Settings → Community plugins.
4. For Obsidian Sync, enable plugin synchronization on both devices, wait for synchronization, and reload the plugin on the receiving device.

## Google Cloud setup

1. Enable the Cloud Text-to-Speech API and billing in your Google Cloud project, then create an API key with appropriate API restrictions.
2. In Obsidian Settings → Roudoku, create or select a SecretStorage entry for your Google API key. Register credentials separately on each device.
3. Use the connection check to fetch Google's Japanese voice list. This does not synthesize speech or guarantee synthesis will succeed.
4. Open the player using the waveform ribbon icon or the **プレイヤーを開く** command. Press **Google Cloud**.
5. Open a note and choose **このノートを読み上げ** from the ribbon or command palette. A sample playback button is also available in Settings → Roudoku.

The default provider is device speech. Choose Google Cloud in the player to use cloud voices.
On mobile, the player is accessible through Obsidian's standard right sidebar. Tap the note title in the compact bar to return to the player.

## Privacy and costs

- Google playback sends the processed note text to `texttospeech.googleapis.com` with your API key. Google's terms and your project's API charges apply.
- There is no plugin-operated server, telemetry, or analytics.
- The plugin stores the **SecretStorage entry name**, not the API key itself, in plugin settings. Plain-text key storage is not supported.
- Device speech uses the Web Speech API, preferring locally installed Japanese voices. Availability and offline behavior depend on your OS and installed voices.
- The plugin does not log note text, raw API error bodies, or API keys.
- Stopping discards late responses and unused prefetched audio, but cannot cancel charges for requests already sent.
- Previous/next buttons move between text segments and can trigger new synthesis and additional charges. This release has no persistent audio cache.

## Limitations

Progress is shown in completed segments, not elapsed seconds. While a segment plays, one following segment is synthesized ahead. The first segment and slow network responses can still require waiting. Device-speech speed changes restart the current segment.

Screen-lock and background playback are not guaranteed. There is no MP3 export, folder queue, second-based seeking, or support for other cloud providers in this release.

Markdown preprocessing skips frontmatter, code, images, URLs, and comments. Link labels and table text are retained. Embedded notes are not expanded.

## 日本語

日本語ノートをGoogle Cloudの音声で聴くObsidianプラグインです。クラウド音声はGoogle Cloudのみ対応し、端末の標準音声は代替として利用できます。

設定 → 朗読でAPIキーをSecretStorageへ登録し、プレイヤーの「音声」でGoogle Cloudを選んでください。本のアイコンからノートを読み上げ、波形アイコンから右サイドバーのプレイヤーを開けます。閉じても再生は続き、下部バーから一時停止・再開できます。

Googleへ本文が送信され、利用者のGoogle CloudプロジェクトにAPI料金が発生します。キーは端末ごとに登録してください。前後ボタンは区間単位の移動で、読み直しは再合成になります。ロック中・バックグラウンドでの継続は保証していません。

## Development

Use Node.js 24 or later.

```sh
npm ci
npm run check
npm run format:check
npm run package
```

The package command validates the source and creates release assets in `dist/roudoku/` and a ZIP archive. Attach the three plugin files individually to a GitHub Release whose tag exactly matches `manifest.json`.

## License and credits

MIT License. Architecture ideas were informed by [Obsidian Voice](https://github.com/chrisurf/obsidian-voice). This plugin's text processing, playback, settings, and provider implementation were written independently. Build and lint configuration was informed by the official Obsidian sample plugin.

## 0.0.5 — automatic sentence-length recovery

When Google rejects a request because a sentence is too long, Roudoku retries that segment as separate sentences, then splits only the fragments that still fail. Text order and content are preserved. Recovery is limited to four splitting levels, 32 synthesis attempts and 60 seconds of cumulative synthesis waiting per original segment. Playback time is excluded. Additional API calls may incur charges.

Stopping or changing segments cancels further retries and discards late audio. After a failure, the play button retries the failed fragment without replaying completed fragments. Authentication, quota and other unrelated errors do not trigger sentence splitting.

Validated with 47 automated tests and a Mac playback check; the user also confirmed the fix works. Full long-note playback, Android/iPad and background playback are not comprehensively verified.


## 0.0.8 — prefetch and transcript navigation

The player prepares one following audio segment while the current segment plays. Unused prefetched speech is still billable. Prefetch failures are handled when playback reaches that segment; stop and seek discard obsolete audio.

Use **本文を表示** to load the note without synthesizing audio, then press a text segment to play from that point. The current segment is highlighted. **再生位置を表示** returns the transcript to the current position; long notes use pages of 60 segments. Stopping keeps the position in memory until the plugin or app closes, or another note is loaded. Resume starts that segment again, not the exact stopped second.

Cloud and device speech are selected with two buttons, avoiding the native provider dropdown on iPhone. The selection applies when loading or starting a note; it does not replace an existing playback session.
