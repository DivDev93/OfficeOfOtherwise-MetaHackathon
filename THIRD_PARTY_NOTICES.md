# Third-party notices

Independently authored application code in this repository is licensed under MIT. External packages are installed from npm and retain their own licenses; no parser implementation is copied into this repository.

| Dependency | Version | License |
|---|---|---|
| `@meta-sam/parser` | 0.1.0 | [Meta SAM License](docs/licenses/meta-sam-parser.txt) |
| `pngjs` | 7.0.0 | [MIT](docs/licenses/pngjs.txt) |
| `three` | 0.170.0 | [MIT](https://github.com/mrdoob/three.js/blob/r170/LICENSE) |
| `globe.gl` | 2.46.0 | [MIT](docs/licenses/globe.gl-MIT.txt) |
| Inter | Google Fonts CSS (Inter Project) | [SIL Open Font License 1.1](docs/licenses/inter-OFL.txt) |
| Cormorant Garamond | Google Fonts CSS (Cormorant Project) | [SIL Open Font License 1.1](docs/licenses/cormorant-garamond-OFL.txt) |

The SAM parser is a separately licensed dependency, not MIT-licensed code. Its license permits use and distribution subject to its terms, including restrictions on use and reverse engineering. When redistributing SAM materials or derivatives, retain the SAM License and distribute those materials under that agreement. Read the full included license before use or redistribution.

Upstream: [Meta parser source and license](https://github.com/meta-models/meta-sam/tree/main/typescript/packages/parser), [pngjs source](https://github.com/pngjs/pngjs).

The Inter and Cormorant Garamond typefaces are loaded through Google Fonts CSS and are covered by the SIL Open Font License 1.1; the full upstream notices are included for redistribution attribution. `globe.gl` is MIT licensed; its version here is the integration's intended 2.46.0 pin.

## NASA Blue Marble globe texture

`web/assets/earth-blue-marble.jpg` is an 8192 × 4096 equirectangular JPEG assembled left-to-right from the official NASA/Goddard Space Flight Center Scientific Visualization Studio [Blue Marble east hemisphere](https://svs.gsfc.nasa.gov/vis/a000000/a002900/a002915/bluemarble-east-4096.png) and [west hemisphere](https://svs.gsfc.nasa.gov/vis/a000000/a002900/a002915/bluemarble-west-4096.png) downloads listed on [SVS item 2915](https://svs.gsfc.nasa.gov/2915). The PNG sources are 4096 × 4096 (13,562,164 and 8,739,790 bytes); they were joined west then east and encoded directly as a progressive JPEG at quality 88 with 4:4:4 chroma sampling (4,716,836 bytes), with no tint or tonal adjustment. Source credit: NASA/Goddard Space Flight Center Scientific Visualization Studio; Blue Marble Next Generation data courtesy of Reto Stockli (NASA/GSFC) and NASA's Earth Observatory.

**Copyright and reuse:** NASA states that its content is generally not subject to U.S. copyright and may be reused under its [Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/). NASA is credited here; the texture is used factually and does not imply NASA endorsement. The texture is not covered by this repository's MIT code license.

`web/assets/earth-relief.png` is a 2048 × 1024, 8-bit grayscale elevation texture derived from NOAA NCEI's [ETOPO1 Ice Surface grid-registered GeoTIFF](https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO1/data/ice_surface/grid_registered/georeferenced_tiff/ETOPO1_Ice_g_geotiff.zip). The source WGS 84 geographic grid is north-up and west-to-east; it was resampled to equirectangular dimensions, then linearly normalized from its source elevation range (−10,898 m to 8,271 m) to grayscale 0–255. Credit: NOAA National Centers for Environmental Information (NCEI), ETOPO1 Global Relief Model, [doi:10.7289/V5C8276M](https://doi.org/10.7289/V5C8276M). NOAA states ETOPO1 is public domain in the U.S., requires NCEI attribution, and must not be used for navigation ([use terms](https://www.ngdc.noaa.gov/mgg/global/dem_faq.html)). The derived texture is not covered by this repository's MIT code license.
