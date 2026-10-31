# Local judge setup

Office of Otherwise is presented to judges as a local application. Public app hosting, previews, tunnels, and cloud deployment are not required or authorized. This document covers local replay and optional fresh Meta functionality only.

The former Office cloud service, revisions, and dedicated image repository have been removed. Historical cleanup evidence is recorded in [HACKATHON.md](HACKATHON.md); it is not part of the local setup below.

## Credential-free saved replay

Install Node.js 22.9.0 or newer, clone the public repository, then run:

```bash
npm ci --ignore-scripts
npm run demo
```

Open `http://127.0.0.1:3000`. When `META_API_KEY` is unset, the server displays packaged saved runs in replay-only mode and makes no model calls. The offline suite can be run with `npm test`.

## Optional fresh Meta functionality

To generate new branches, continuations, event scenes, SAM 3.1 cutouts, or voice transcripts locally:

1. Copy `.env.example` to `.env` and set your own `META_API_KEY` in that server-side file.
2. Review `META_SPEND_CAP_USD` and optional `DEMO_DAILY_CAP_USD`. The shared client records Meta usage in `out/spend.json`; preserve any existing ledger and do not reset it to bypass a ceiling.
3. Run `npm run demo` on loopback at `http://127.0.0.1:3000`.

The key remains server-side and is not put in browser storage or URLs. A Meta API key supports the listed Meta features; it does not provide access to the preexisting private Tattva/Chronos infrastructure. Fresh SAM 3D Objects generation is not available in the judge setup. The four saved SAM 3D Objects meshes were generated separately and attached with their provenance; they can be inspected in local replay.

The released v2 video is an edited saved-result walkthrough, not footage of fresh generation. Its immutable release tag and earlier capture provenance remain distinct from corrective source changes.
