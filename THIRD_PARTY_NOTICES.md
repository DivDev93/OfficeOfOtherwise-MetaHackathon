# Third-party notices

Independently authored application code in this repository is licensed under MIT. External packages are installed from npm and retain their own licenses; no parser implementation is copied into this repository.

| Dependency | Version | License |
|---|---|---|
| `@meta-sam/parser` | 0.1.0 | [Meta SAM License](docs/licenses/meta-sam-parser.txt) |
| `pngjs` | 7.0.0 | [MIT](docs/licenses/pngjs.txt) |
| `three` | 0.170.0 | [MIT](https://github.com/mrdoob/three.js/blob/r170/LICENSE) |

The SAM parser is a separately licensed dependency, not MIT-licensed code. Its license permits use and distribution subject to its terms, including restrictions on use and reverse engineering. When redistributing SAM materials or derivatives, retain the SAM License and distribute those materials under that agreement. Read the full included license before use or redistribution.

Upstream: [Meta parser source and license](https://github.com/meta-models/meta-sam/tree/main/typescript/packages/parser), [pngjs source](https://github.com/pngjs/pngjs).

## NASA Blue Marble globe texture

`web/assets/earth-blue-marble.jpg` is a locally served, resized and teal-tinted 2048 × 1024 JPEG derived from NASA/Goddard Space Flight Center Scientific Visualization Studio's [Blue Marble - A Seamless Image Mosaic of the Earth](https://svs.gsfc.nasa.gov/2915). The downloaded source was `bluemarble-2048.png` (1.4 MB); the web texture is compressed to 235,817 bytes. Source credit: NASA/Goddard Space Flight Center Scientific Visualization Studio; Blue Marble Next Generation data courtesy of Reto Stockli (NASA/GSFC) and NASA's Earth Observatory.

**Copyright and reuse:** NASA states that its content is generally not subject to U.S. copyright and may be reused under its [Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/). NASA is credited here; the texture is used factually and does not imply NASA endorsement. The texture is not covered by this repository's MIT code license.
