# Persistent branch continuation and scene-only prefetch

This document describes the persistent branch continuation, per-event scene/cutout generation, and immediate-child scene-only prefetch architecture in the local submission candidate. Keep PR #7 open, draft, and unmerged. Nothing in this document authorizes unapproved publication, deployment, a budget increase, or private Tattva 3D generation.

## Interaction and prefetch boundary

1. **Start from a premise or saved root:** **Explore** starts a root question (or you can open any saved story from **The Archive**).
2. **Select an event and stay on that event:** Clicking a branch in the Exploration Tree, a consequence button under **What could happen next**, a ready node in the **Exploration map**, or a globe pin selects that exact event and keeps it selected without jumping away to a different branch.
3. **Automatic scene and immediate consequences for the selected event:** Selecting an event automatically loads (or generates, when local live access is enabled) that event's matching scene (`GET/POST /api/event-scene`) and its immediate downstream consequences (`POST /api/continue` or saved child manifest).
4. **Immediate-child scene-only prefetch (`sceneOnly`):** Once an event's immediate consequences exist, `prefetchEventScenes` queues background `sceneOnly` jobs to prepare scenes for those immediate child events only. It **never** generates consequences for unselected children.
5. **Iterative path exploration:** Selecting a child event repeats the same process for that child—loading its already-prefetched scene, requesting its immediate consequences, and prefetching scenes only for its immediate children.
6. **Ancestry and reload persistence:** Ancestry breadcrumbs (`#world-path`), the nested Exploration Tree (`#exploration-tree-status`), the spatial Exploration Map (`#starmap`), and `#run=` URL hashes preserve your path across navigation, browser reload, and server restart. Completed saved scenes, cutouts, and continuations reopen without duplicate model calls.

## Path length

A continuation path can contain up to six selected events. At that limit, the browser explains how to return to an earlier world instead of sending another continuation request; the server independently rejects over-depth requests. Saved descendants, ancestors and their artifacts remain available, so you can reopen an earlier event and explore an alternative. This is a path-length constraint, separate from the configurable cumulative and daily Meta spend ceilings.

## Persistence and API routes

- `POST /api/continue` accepts `{ runId, branchId }` and resolves the selected branch and its full ancestry from server-side saved manifests. Client-supplied history, alternate paths, and forged assumptions are rejected. Each child must have a later nonzero integer year and an explicit causal link.
- `GET /api/event-scene` checks for a saved event image; `POST /api/event-scene` renders a missing scene from the server-resolved event, ancestry, and scenario geography using **Muse Image** (`muse-image-1.0`).
- `GET /api/event-cutout` checks for a saved event cutout; `POST /api/event-cutout` isolates the event's subject from its saved scene using **SAM 3.1** (`sam-3.1`).
- `GET /api/history` lists completed local runs; `GET /runs/:id` includes `continuation` metadata (`rootRunId`, `parentRunId`, `parentBranchId`, `path`, and `children`).
- Independent scene, continuation, and cutout jobs share a bounded client queue (`MAX_EVENT_JOBS = 3`) and server-side atomic reservations under `out/` (`liveRunsDir/.continuation`, `.event-scenes`, `.event-cutouts`) and `out/spend.json`.
- Failed or interrupted dispatches are recorded (`retryable`, `failed`, or `uncertain`) with clear status messages and recovery actions (`Try again` when retryable) rather than leaving an indefinite loading state or silently retrying uncertain paid calls.

## Verification summary

- **Offline test suite:** 289/289 unit and integration tests pass on Node 22.23.3 (`node --test --test-concurrency=1 --test-reporter=dot`), including explicit regression tests in `test/continuationUi.test.js` verifying that selecting an event prefetches scenes **only** for immediate children (`sceneOnly`) and makes zero child-continuation calls until a child is selected.
- **Browser end-to-end journey:** Exercised in headless Chrome via Playwright across the 10-step acceptance journey (premise/saved root → select event → matching scene → clickable consequences → 3 successive choices → return to earlier event & branch → reload persistence → scenario geography & assumptions → zero-spend saved reuse → failure recovery & narrow viewport layout).
