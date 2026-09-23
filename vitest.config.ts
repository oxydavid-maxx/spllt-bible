import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // expo-audio pulls in expo-modules-core's native registry at import time, which does not exist in
      // the node test environment. Rendering the reader imports the chapter audio controls, so the alias
      // keeps component tests runnable. The double is inert: it can never make a playback claim pass.
      // Real adapter behaviour is asserted in tests/expoAudioPlayback.test.ts, and actual playback is
      // only ever claimed from device evidence off the real player.
      'expo-audio': fileURLToPath(new URL('./tests/doubles/expo-audio.ts', import.meta.url)),
      // Same reason, arriving through the update banner on the reading tab: expo-application reads
      // the native registry at import time, so every component test that renders that tab failed to
      // load rather than failed an assertion.
      'expo-application': fileURLToPath(new URL('./tests/doubles/expo-application.ts', import.meta.url)),
      // And again through expo-crypto, which the completion flow uses for operation ids.
      'expo-crypto': fileURLToPath(new URL('./tests/doubles/expo-crypto.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    setupFiles: ['tests/setup.ts'],
  },
});
