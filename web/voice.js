// Local prototype: audio exists only in memory and never starts an exploration.
export function encodeWav(samples, rate = 24_000) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const word = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); });
  return new Blob([bytes], { type: 'audio/wav' });
}

export async function prepareVoiceAudio(blob, platform = globalThis) {
  if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('Keep your recording under 8 MB.');
  const context = new platform.AudioContext();
  let decoded;
  try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
  finally { await context.close(); }
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 30) throw new Error('Keep your recording under 30 seconds.');
  const offline = new platform.OfflineAudioContext(1, Math.ceil(decoded.duration * 24_000), 24_000);
  const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
  const mono = await offline.startRendering();
  return encodeWav(mono.getChannelData(0));
}

export function createVoiceInput({ prompt, access, controls, record, stop, cancel, message,
  platform = globalThis, fetchImpl = (...args) => fetch(...args), prepare = prepareVoiceAudio } = {}) {
  let enabled = false, localAccess = false, sequence = 0, stream, recorder, chunks = [], timer, request, recording = false, working = false;
  function render() {
    controls.hidden = !enabled;
    record.disabled = !enabled || recording || working;
    stop.hidden = !recording; cancel.hidden = !recording && !working;
  }
  function stopTracks() { stream?.getTracks().forEach(track => track.stop()); stream = undefined; clearTimeout(timer); }
  function discard(text = '') {
    sequence++; request?.abort(); request = undefined;
    stopTracks();
    if (recorder?.state === 'recording') recorder.stop();
    recorder = undefined; chunks = []; recording = working = false; message.textContent = text; render();
  }
  async function upload(blob, id, original) {
    working = true; recording = false; render(); message.textContent = 'Preparing your recording…';
    try {
      const audio = await prepare(blob, platform);
      if (id !== sequence) return;
      request = new AbortController();
      timer = setTimeout(() => request?.abort(), 50_000);
      message.textContent = 'Turning your words into a question…';
      const response = await fetchImpl('/api/transcribe', { method: 'POST', headers: { 'content-type': 'audio/wav', 'x-demo-access-code': access.value }, body: audio, signal: request.signal });
      if (!response.ok) throw new Error('Voice input could not finish. Check your code or try again later.');
      const result = await response.json();
      if (id !== sequence || prompt.value !== original) return;
      if (typeof result.transcript !== 'string' || !result.transcript.trim()) throw new Error('No words were heard. Try another recording.');
      prompt.value = result.transcript.trim().slice(0, 500); prompt.focus();
      message.textContent = 'Review your transcript. You can edit the question above.';
    } catch (error) {
      if (id === sequence) message.textContent = error.name === 'AbortError' ? 'Voice input stopped. Please try again.' : error.message;
    } finally {
      if (id === sequence) { clearTimeout(timer); request = undefined; working = false; render(); }
    }
  }
  async function start() {
    if (!enabled) return;
    discard();
    if (!localAccess && !access.value) { message.textContent = 'Enter your access code to use voice input.'; access.closest('details')?.setAttribute('open', ''); access.focus(); return; }
    if (!platform.navigator?.mediaDevices?.getUserMedia || !platform.MediaRecorder) { message.textContent = 'Microphone recording is unavailable in this browser. Type your question above.'; return; }
    const id = sequence, original = prompt.value;
    working = true; render(); message.textContent = 'Allow microphone access to record.';
    try {
      const acquired = await platform.navigator.mediaDevices.getUserMedia({ audio: true });
      if (id !== sequence) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired; recorder = new platform.MediaRecorder(stream); chunks = [];
      let bytes = 0;
      recorder.ondataavailable = event => {
        if (id !== sequence || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > 8 * 1024 * 1024) { discard('The recording was too large. Please try a shorter question.'); return; }
        chunks.push(event.data);
      };
      recorder.onerror = () => { if (id === sequence) discard('Recording failed. Try again or type your question above.'); };
      recorder.onstop = () => {
        if (id !== sequence) return;
        stopTracks();
        const blob = new Blob(chunks, { type: recorder.mimeType }); chunks = []; recorder = undefined;
        upload(blob, id, original);
      };
      recorder.start(250); recording = true; working = false; render();
      message.textContent = 'Listening… Speak your what-if, then select Stop. Up to 30 seconds.';
      // Leave a little room for MediaRecorder's final encoded frame.
      timer = setTimeout(finish, 29_000);
    } catch { if (id === sequence) discard('Microphone access was unavailable. Allow microphone access and try again, or type your question above.'); }
  }
  function finish() { if (recorder?.state === 'recording') { recorder.stop(); stopTracks(); recording = false; working = true; render(); } }
  record.addEventListener('click', start); stop.addEventListener('click', finish);
  cancel.addEventListener('click', () => discard('Voice input cancelled.'));
  prompt.addEventListener('input', () => discard()); access.addEventListener('input', () => discard());
  platform.addEventListener?.('pagehide', () => discard());
  platform.addEventListener?.('beforeunload', () => discard());
  render();
  return { cancel: discard, setLocalAccess(value) { localAccess = value === true; }, setEnabled(value) { enabled = value === true; if (!enabled) discard(); render(); } };
}
