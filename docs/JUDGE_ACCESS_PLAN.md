# Judge access and 3D scope

## Public replay demo

The public judge demo is the [Office of Otherwise replay app](https://office-otherwise-875096283797.northamerica-northeast2.run.app). It exposes saved worlds in replay-only mode without credentials or model spend. The submission also includes a public GitHub repository and a video release asset; the official form has no hosted-app URL field.

## Fresh Meta exploration

The public repository supports credential-free saved replay. For local fresh branching, consequences, event scenes, SAM 3.1 cutouts, and optional voice transcription, a judge can clone the repository, place their own Meta Model API key in the ignored server-side `.env`, review the configured spend ceilings, and run `npm run demo` on loopback. The browser does not receive the Meta API key. See [the README setup](../README.md#run-it-locally).

## SAM 3D Objects boundary

The four saved root worlds include genuine Meta SAM 3D Objects meshes generated separately through the preexisting private Tattva runner and attached to this repository with provenance. Judges can inspect those saved objects in replay mode. This submission does not offer fresh SAM 3D Objects generation to judges. A Meta Model API key does not provide private Tattva authorization or a SAM 3D endpoint. The optional public live adapter supports TRELLIS only when separately configured; it is not SAM 3D Objects. Do not provision or promise fresh private 3D access as part of judge setup.

The private Tattva/Chronos backend, credentials, and GPU infrastructure remain outside this public repository and submission scope.
