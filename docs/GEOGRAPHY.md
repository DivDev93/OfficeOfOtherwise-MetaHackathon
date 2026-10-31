# Meta-driven scenario geography

This document describes how Office of Otherwise attaches structured scenario geography conditions to counterfactual branches and paints illustrative regional masks onto the 3D Earth globe. Keep PR #7 open, draft, and unmerged.

## Model and rendering roles

**Muse Wonder** (`muse-wonder-1.0`) selects structured geographic conditions while proposing branches and continuations. Each condition includes a stable ID, supported region, change kind, visual intensity, scenario assumption, and uncertainty note. The topic policy (`src/guardrails/topicPolicy.js`) checks descriptive text, and schema validation (`web/geographyTexture.js`) bounds supported regions, types, intensity, and text length. Model-generated coordinates, executable code, and external URLs are rejected.

The browser paints supported masks onto the globe surface texture starting from the present-day NASA Blue Marble base image. A **Present day / Scenario** toggle in the **Earth surface** panel lets the user compare surfaces directly, while the legend displays each condition's assumption and uncertainty. When a scenario includes `ram-setu`, the UI also renders an enlarged regional comparison inset (`#geography-inset`) for Palk Strait / Adam's Bridge.

Conditions accumulate along a path: selected ancestors retain their geographic state in `continuation.path`, and child continuations inherit ancestor conditions without dropping them or decreasing their intensity. Saved runs without geography remain compatible and display present-day reference status without inventing provenance.

## Supported masks and geographic context

Supported regions are `ram-setu`, `sahara`, `doggerland`, `beringia`, `sundaland`, and `northern-europe-ice`, across `land`, `vegetation`, `lake`, and `ice` change kinds. These masks are hand-authored illustrative approximations anchored to geographic regions—not calculated bathymetry, hydrological reconstructions, or physical climate simulations.

- [NASA: Adam’s Bridge](https://science.nasa.gov/photojournal/adams-bridge-india-sri-lanka/) provides geographic context for the ~48 km shoal chain between India and Sri Lanka.
- [Rainfall regimes of the Green Sahara](https://pmc.ncbi.nlm.nih.gov/articles/PMC5242556/) provides context for vegetation and permanent lakes during the African Humid Period.
- [NASA GISS: sea level after the ice melted](https://www.giss.nasa.gov/research/briefs/2007_gornitz_09/) provides glacial sea-level context for exposed continental shelves and ice margins.
