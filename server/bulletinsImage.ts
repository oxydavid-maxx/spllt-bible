import { createRequire } from 'node:module';

/**
 * The image tools behind the 週刊 phone copies (server/bulletinsResize.ts) and the CI fixture and screenshot checks
 * (scripts/ios/). jimp-compact is Jimp 0.16 in one plain JavaScript file: no native code, and Expo already installs it
 * with every backend package folder (expo-asset and expo-notifications need it through @expo/image-utils), so the
 * backend gains no new install. It is loaded only when a copy is made, never at start, so a folder without it still
 * starts and serves the originals.
 */
export interface JimpImage {
  bitmap: { width: number; height: number; data: Uint8Array };
  resize(width: number, height: number): JimpImage;
  quality(value: number): JimpImage;
  getBufferAsync(mime: string): Promise<Uint8Array>;
}
export interface Jimp {
  new (width: number, height: number, background: number): JimpImage;
  read(data: Uint8Array): Promise<JimpImage>;
  AUTO: number;
  MIME_JPEG: string;
  MIME_PNG: string;
}

/** Where jimp-compact is installed; throws when it is not. */
export function jimpPath(): string {
  return createRequire(import.meta.url).resolve('jimp-compact');
}

export function loadJimp(): Jimp {
  return createRequire(import.meta.url)(jimpPath()) as Jimp;
}
