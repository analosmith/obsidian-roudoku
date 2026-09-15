Roudoku 0.0.8 improves everyday playback.

- Prepare one future audio segment during playback to reduce generation gaps.
- Replace the provider dropdown with Google Cloud / device speech buttons.
- Preview the processed note without synthesis, click a segment to start there, and retain the stopped position during the session.
- Highlight the current segment and paginate long transcripts.

Unused prefetched audio may incur Google API charges. First playback and requests slower than the current segment still involve waiting. Stop/resume operates at segment boundaries; position is not persisted across app restarts.

Validated with 55 automated tests and Mac Obsidian 1.13.7 UI checks. The user has confirmed the improvements work in everyday use.
