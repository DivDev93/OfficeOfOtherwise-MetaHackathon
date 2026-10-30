# Invitation flow checks — 2026-10-30

These screenshots document local browser QA of `/pilot.html`, not participant sessions. Organizer desktop is 1280×900; mobile views are 390×844, with a 375px document width and no horizontal overflow.

The browser created three anonymous links and downloaded their CSV. Participant consent started unchecked; the timer refused to start without adult eligibility and note consent. A clearly labeled synthetic QA result was downloaded and imported as preliminary. An unsigned synthetic observation file was also imported: its `observed` flag was reset, and it counted only after explicit facilitator confirmation. A completed failed-task fixture stayed in the denominator. Observation/assessment download worked; malformed JSON was rejected without adding records. Reload cleared all browser entries.

The native date/time control rejected the automation driver's `fill` operation. The save/reconfirmation check used imported fixture timestamps and visibly populated controls instead; this is not evidence of manual date entry. All synthetic records remain ignored under `out/pilot-qa` or local browser downloads and are excluded from participant results.

Pinned Node 22.23.3: 223/223 offline tests passed, including nine invitation, consent, import and assessment tests. No provider call, external invitation, automatic result upload, or browser persistence was added.
