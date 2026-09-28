/** The app icon (the church mark in an open-Bible frame) for in-app screens; its own module so tests can stub the asset. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const BRAND_ICON: number = require('../../assets/icon.png');
/** The same icon at 512 x 512 for the system media card: the card shows it at most about 256 dp, and each
 * decoded copy (playback service, media3, system UI) is a quarter of the 1024 x 1024 icon's 4 MB. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const MEDIA_ARTWORK: number = require('../../assets/media-artwork.png');
