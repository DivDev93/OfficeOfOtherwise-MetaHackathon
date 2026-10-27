import { deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function dimensions(width, height, data, channels) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 0x7fffffff || height > 0x7fffffff || !Number.isSafeInteger(width * height * channels)) throw new Error('Invalid PNG dimensions');
  if (!(data instanceof Uint8Array) || data.length !== width * height * channels) throw new Error('Invalid PNG pixel data length');
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length);
  return result;
}
function writePng(data, width, height, channels, colorType) {
  dimensions(width, height, data, channels);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = colorType;
  const stride = width * channels;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rows.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
export function writeMaskPng(raster, width, height) {
  dimensions(width, height, raster, 1);
  return writePng(Uint8Array.from(raster, value => value ? 255 : 0), width, height, 1, 0);
}
export function writeCutoutPng(rgba, width, height) { return writePng(rgba, width, height, 4, 6); }
export function decodePng(buffer) {
  const { width, height, data } = PNG.sync.read(buffer);
  return { width, height, data };
}
export function applyMask(rgba, raster, width, height) {
  dimensions(width, height, rgba, 4); dimensions(width, height, raster, 1);
  const result = Uint8Array.from(rgba);
  for (let i = 0; i < raster.length; i++) if (!raster[i]) result[i * 4 + 3] = 0;
  return result;
}
