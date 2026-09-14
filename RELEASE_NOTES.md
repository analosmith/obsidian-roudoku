Roudoku 0.0.7 addresses the community automated review findings.

- Settings can be found through Obsidian's settings search on 1.13 and later. Earlier supported versions retain the settings page.
- The mini-player now manages its workspace state explicitly. CSS no longer uses `:has` or `!important` to reserve reading space.
- Releases are built and tested in GitHub Actions. Build provenance is generated and verified for `main.js`, `manifest.json`, and `styles.css` before publication.

Google Cloud remains the only supported cloud provider, with device speech as a fallback. The narration and long-sentence recovery behavior is unchanged.

Tracks [#1](https://github.com/analosmith/obsidian-roudoku/issues/1).
