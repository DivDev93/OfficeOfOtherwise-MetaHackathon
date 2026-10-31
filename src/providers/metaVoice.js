import { join } from 'node:path';
import { createMetaClient } from '../lib/metaClient.js';
import { fileLedger } from '../lib/spendLedger.js';
import { configuredSpendCap, configuredDailyCap, resolveLedgerPath } from '../demo/budget.js';

export const VOICE_MODEL = 'muse-voice-transcribe-1.0';
export const MAX_AUDIO_BYTES = 44 + 30 * 24_000 * 2;
export const VOICE_HOURLY_USD = 0.18;

// Deliberately accept the canonical WAV produced by our browser converter only:
// one PCM format and one data chunk, with no embedded metadata or extra payload.
export function validateVoiceWav(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 46 || audio.length > MAX_AUDIO_BYTES) throw new Error('Invalid audio');
  if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE' ||
      audio.toString('ascii', 12, 16) !== 'fmt ' || audio.toString('ascii', 36, 40) !== 'data' ||
      audio.readUInt32LE(4) !== audio.length - 8 || audio.readUInt32LE(16) !== 16 ||
      audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1 || audio.readUInt16LE(34) !== 16 ||
      audio.readUInt16LE(32) !== 2 || audio.readUInt32LE(40) !== audio.length - 44 || (audio.length - 44) % 2) throw new Error('Invalid audio');
  const rate = audio.readUInt32LE(24);
  if (![16_000, 24_000].includes(rate) || audio.readUInt32LE(28) !== rate * 2) throw new Error('Invalid audio');
  const durationSeconds = (audio.length - 44) / (rate * 2);
  if (durationSeconds <= 0 || durationSeconds > 30) throw new Error('Invalid audio');
  return { durationSeconds, sampleRate: rate };
}

export function createMetaVoice({ client } = {}) {
  if (!client?.meteredMultipart) throw new Error('Metered Meta client required');
  return async ({ audio, signal, timeoutMs }) => {
    const { durationSeconds } = validateVoiceWav(audio);
    const costUsd = durationSeconds * VOICE_HOURLY_USD / 3600;
    const form = new FormData();
    form.append('request', new Blob([JSON.stringify({ model: VOICE_MODEL, mode: 'PUSH_TO_TALK', audioEncoding: 'WAV' })], { type: 'application/json' }));
    form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'prompt.wav');
    const response = await client.meteredMultipart('/asr/transcribe', form, { costUsd, model: VOICE_MODEL, durationSeconds, label: 'voice:transcribe', signal, timeoutMs });
    if (typeof response?.transcript !== 'string') throw new Error('Invalid transcription');
    return { transcript: response.transcript.trim().slice(0, 500) };
  };
}

export function createDemoTranscriber({ env = process.env, outputRoot = 'out' } = {}) {
  if (!(env.META_API_KEY || env.MODEL_API_KEY)?.trim()) throw new Error('META_API_KEY is not set');
  const spendCapUsd = configuredSpendCap({ env, outputRoot });
  const dailyCapUsd = configuredDailyCap({ env, spendCapUsd });
  if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0) throw new Error('Invalid daily cap');
  const client = createMetaClient({ env, ledger: fileLedger(resolveLedgerPath({ env, outputRoot }), { requireExisting: true }),
    spendCapUsd, dailyCapUsd });
  const transcribe = createMetaVoice({ client });
  transcribe.enforcesDailyCap = true;
  return transcribe;
}
