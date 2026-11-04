# Final recording fixes — November 4, 2026

The before images use the tracked frontend from `a21d2b7`, served temporarily against the existing local saved data. The comparison server was stopped after capture. The after images use the final working frontend and the same saved questions.

The saved Arabia case has eight permanent events from 245–22 BCE and one unwoven suggestion. All eight events were preserved. Green Sahara has one permanent event at 2800 BCE.

| View | Before, 1440×900 | After, 1440×900 |
| --- | --- | --- |
| Landing | [Before](before-landing-1440.png) | [After](after-landing-1440.png) |
| Arabia on open | [Before](before-arabia-open-1440.png) | [After](after-arabia-open-1440.png) |
| Suggestion deck | [Before](before-deck-1440.png) | [After](after-deck-1440.png) |

## Verified behavior

- Saved question pickers, date-less links, Atlas question chips and sibling-history switches select the latest event. A dated link before every saved event clamps to the first event. An intentional scrub before the first event keeps that event in the sheet instead of displaying an empty-history heading.
- Arabia opens at 22 BCE with Taif selected and its gold pins visible between the rail and right sheet. Green Sahara opens at 2800 BCE with Sailboats selected and no singleton era header. Date scrubbing selected the nearest preceding event in both cases.
- Adjacent Hellenistic Era/Period groups merge. Era labels have separate bounded intervals and full labels on hover.
- The surface chip is above the timebar in the visible gap. Its expanded panel is in the upper corner, outside the globe centre and timebar.
- List and Deck overflow menus retain selection, Keep all fits, review, Undo, preferences and gallery access. Native Select none/all changed the batch count from one to zero and back. Deck Not now and overflow Undo restored the same saved suggestion. The mobile gallery had a visible working Close button.
- The landing faces Afro-Eurasia, with the mic inside the question field and all four starters directly below the input.

The final local Node 22.23.3 suite passed **847/847**. Fixtures cover future single/batch weaves advancing the date before rendering the new canonical pins; no live weave was performed for this final-day check. Verification preserved all saved events and used **zero model calls / $0 additional spend**. No requested fix is left incomplete. Voice capture itself was not recorded, and no deployment or submission was performed.

## Start the app for recording

The existing local launcher loads `.env`, the saved histories and the current `out/spend.json` ledger. From PowerShell:

```powershell
Set-Location 'D:\OfficeOfOtherwise-MetaHackathon'
& 'C:\Users\divak\.codex\tools\ooo-local-validation\node-v22.23.3\node-v22.23.3-win-x64\node.exe' --env-file-if-exists=.env out/history-model-review/serve-history-4313-20261102.mjs
```

Open <http://127.0.0.1:4313/>. Port 4313 must be free before starting another instance; the app may already be running there. This is the normal live app with saved histories, not a replay-only mode. Private 3D jobs remain disabled.
