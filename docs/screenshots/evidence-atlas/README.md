# Evidence and scenario brief UI — 2026-10-29

These captures show the local replay with the evidence-and-brief changes. The published replay predates this batch.

- `desktop-brief.jpg`: 1280 × 720, Alexandria's selected branch, baseline sources, changed assumption, and hypothetical causal steps.
- `mobile-brief.jpg`: 390 × 844, the same evidence workflow at a narrow viewport.

Manual checks covered all four starting-question buttons, evidence panels, saved 3D views, branch comparison, and Markdown export. The simulated unavailable-classifier entry remains explicitly labeled. Mobile document width stayed within the 390px viewport. The browser log contained the existing multiple-Three.js warning and no error entries.

The dedicated `npm run demo:replay` entry point was used, with no credentials or provider calls. These are UI checks, not user feedback or validation of the counterfactual claims.
