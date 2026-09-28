import { inflateSync } from 'node:zlib';

/** Pixels of an 8-bit RGB or RGBA, non-interlaced PNG, always returned as RGBA. Enough for the app's own assets. */
export function readPng(file: Buffer): { width: number; height: number; data: Buffer } {
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const colorType = file[25];
  if (file[24] !== 8 || (colorType !== 2 && colorType !== 6) || file[28] !== 0) throw new Error('expected an 8-bit RGB/RGBA non-interlaced PNG');
  const channels = colorType === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let at = 8; at < file.length; at += 12 + file.readUInt32BE(at)) {
    if (file.toString('latin1', at + 4, at + 8) === 'IDAT') chunks.push(file.subarray(at + 8, at + 8 + file.readUInt32BE(at)));
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? rows[y * stride + x - channels] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels] : 0;
      const paeth = [left, up, corner].sort((a, b) => Math.abs(left + up - corner - a) - Math.abs(left + up - corner - b))[0];
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter];
      rows[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: rows };
  const data = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rows.copy(data, pixel * 4, pixel * 3, pixel * 3 + 3);
    data[pixel * 4 + 3] = 255;
  }
  return { width, height, data };
}
