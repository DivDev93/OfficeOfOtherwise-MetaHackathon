# Push-to-talk voice prompt transcription

Office of Otherwise supports optional push-to-talk voice dictation for the “what if?” prompt using **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`). Voice transcription populates the editable prompt field only; the user reviews and edits the question before clicking **Explore**, and transcription never auto-submits a generation run.

## Local configuration and startup

Voice transcription is enabled automatically on loopback (`127.0.0.1`) when `META_API_KEY` is configured in `.env` and `npm run demo` is started (`DEMO_VOICE_ENABLED=true` by default when `META_API_KEY` is present; set `DEMO_VOICE_ENABLED=false` to hide voice controls). All calls pass through `createMetaVoice` (`src/providers/metaVoice.js`) and the shared spend ledger (`out/spend.json`) governed by `META_SPEND_CAP_USD` and `DEMO_DAILY_CAP_USD`.

The local candidate video only shows the voice control in the replay UI. It does not record a fresh microphone capture or a live transcription response.

## Behavior and safety bounds

1. **Browser capture and canonical WAV conversion:** **Record**, **Stop**, and **Cancel** capture microphone audio on `localhost`/`127.0.0.1` or HTTPS, capped at 8 MiB and 30 seconds (auto-stopping at 29 seconds), resampled in memory to mono 24 kHz 16-bit PCM WAV. All microphone tracks are stopped immediately on Stop, Cancel, error, timeout, or page unload.
2. **Server validation:** `POST /api/transcribe` accepts only `audio/wav`, validates a canonical 44-byte RIFF/WAVE header (mono 16-bit PCM at 16 kHz or 24 kHz, `<= 30s`, `<= 1,440,044` bytes), admits one request at a time, and rate-limits starts to five per minute.
3. **Meta ASR contract and metering:** Calls `POST /v1/asr/transcribe` (`multipart/form-data` with `request` JSON `{ model: "muse-voice-transcribe-1.0", mode: "PUSH_TO_TALK", audioEncoding: "WAV" }` and `audio` WAV bytes) per [Meta's speech-to-text documentation](https://dev.meta.ai/docs/speech-to-text). Reserves and records spend at the published `$0.18` per audio hour rate using the full validated WAV duration. Audio and transcripts remain transient in memory and are never written to disk or logs.
