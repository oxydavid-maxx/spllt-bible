import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const collector = readFileSync(new URL('../../scripts/ios/collect-failure.sh', import.meta.url), 'utf8');

describe('iOS failure evidence before diagnostic side effects', () => {
  it('captures the native screen before logs or a new Maestro hierarchy session', () => {
    const native = collector.indexOf('xcrun simctl io "$UDID" screenshot "$DIR/$NAME-native-screen.png"');
    expect(native, 'A black Maestro PNG must be distinguishable from the simulator rendered frame.').toBeGreaterThan(-1);
    expect(native).toBeLessThan(collector.indexOf('log show'));
    expect(native).toBeLessThan(collector.indexOf('maestro --device'));
    expect(collector).toContain('$NAME-native-screen-capture.txt');
  });

  it('keeps non-error audio diagnostics separate from the generic error-only tail', () => {
    expect(collector).toContain('$NAME-audio.txt');
    expect(collector).toContain('\\[chapter-audio\\]|AVAudioSession|AVPlayer|playbackStatus|timeControlStatus');
    expect(collector).toContain('--last 5m --info --debug');
    // These ordinary lifecycle lines were absent from the old error-only file.
    const audio = /\[chapter-audio\]|AVAudioSession|AVPlayer|playbackStatus|timeControlStatus/i;
    for (const line of ['[chapter-audio] pause member PSA.107', 'AVPlayer timeControlStatus=paused']) {
      expect(audio.test(line)).toBe(true);
    }
  });
});
