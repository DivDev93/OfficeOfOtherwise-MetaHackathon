// Pull the first JSON value (object or array) out of model text that may wrap it
// in prose or ```json fences. Returns undefined when nothing parses.
export function extractJson(text) {
  const s = String(text ?? '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1], s] : [s];
  for (const c of candidates) {
    // try whichever opener appears first, so an array isn't mistaken for its first element
    const openers = ['{', '['].map(o => [o, c.indexOf(o)]).filter(([, i]) => i !== -1).sort((a, b) => a[1] - b[1]);
    for (const [open, start] of openers) {
      const close = open === '{' ? '}' : ']';
      // scan for a balanced end, respecting strings
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < c.length; i++) {
        const ch = c[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === open) depth++;
        else if (ch === close && --depth === 0) {
          try { return JSON.parse(c.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  return undefined;
}
