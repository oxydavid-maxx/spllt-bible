import { describe, expect, it } from 'vitest';
import {
  chapterAudioRenderMode,
  resolveChapterAudioSession,
  QA_EVIDENCED_CHAPTER_USFM,
  QA_EVIDENCED_VERSION_ID,
  isQaTestAudioEnabled,
} from '../src/services/audioChapterResolver';

// Steering 96. The production recording resolver is NOT established, so production audio stays
// honestly disabled. A QA-only source exists for integration verification, tied to the ONE chapter the
// standalone POC already evidenced (JHN.13 / 約13). Two rules matter more than anything else here:
//   1. the QA source must never reach a pilot build
//   2. a recording must never be labelled as a chapter it is not
const QA_URI_FOR_TESTS = 'https://example.invalid/qa/JHN13.mp3';

describe('chapter audio resolution', () => {
  const prod = { chapterUsfm: 'PSA.88', versionId: 1392, qaTestAudioEnabled: false };

  it('production is UNAVAILABLE because its resolver is not established', () => {
    const r = resolveChapterAudioSession(prod);
    expect(r.availability.status).toBe('PENDING_PROVIDER');
    expect(r.source).toBeNull();
    expect(r.sourceClass).toBe('none');
    expect(r.productionDeliveryEntitlement).toBe('UNRESOLVED');
  });

  it('production NEVER returns a uri, for any chapter, including the evidenced one', () => {
    for (const chapterUsfm of ['PSA.88', 'JHN.13', 'MAT.5', QA_EVIDENCED_CHAPTER_USFM]) {
      const r = resolveChapterAudioSession({ chapterUsfm, versionId: 1392, qaTestAudioEnabled: false });
      expect(r.source).toBeNull();
      expect(JSON.stringify(r)).not.toMatch(/audio-bible-cdn|\.mp3/);
    }
  });

  it('the QA source resolves ONLY for the evidenced chapter', () => {
    const r = resolveChapterAudioSession({ chapterUsfm: QA_EVIDENCED_CHAPTER_USFM, versionId: QA_EVIDENCED_VERSION_ID, qaTestAudioEnabled: true, qaAudioUri: QA_URI_FOR_TESTS });
    expect(r.availability.status).toBe('READY');
    expect(r.sourceClass).toBe('qa-test-only');
    expect(r.source).not.toBeNull();
    expect(r.source!.chapterUsfm).toBe('JHN.13');
    expect(r.source!.chapterLabel).toBe('約13');
    expect(r.source!.uri).toMatch(/^https:\/\//);
    expect(r.source!.recordingEdition.length).toBeGreaterThan(0);
    expect(r.source!.attribution.length).toBeGreaterThan(0);
  });

  it('REFUSES to offer the evidenced recording for any other chapter', () => {
    for (const chapterUsfm of ['PSA.88', 'PSA.89', 'JHN.3', 'JHN.14', 'MAT.5']) {
      const r = resolveChapterAudioSession({ chapterUsfm, versionId: 1392, qaTestAudioEnabled: true, qaAudioUri: QA_URI_FOR_TESTS });
      expect(r.availability.status).toBe('UNAVAILABLE');
      expect(r.source).toBeNull();
      expect(r.availability.reason).toMatch(/約13|another chapter/);
      // the decisive property: no uri leaks for a chapter the recording is not
      expect(JSON.stringify(r)).not.toMatch(/audio-bible-cdn|\.mp3/);
    }
  });

  it('refuses a text version the recording is not matched to', () => {
    const r = resolveChapterAudioSession({ chapterUsfm: QA_EVIDENCED_CHAPTER_USFM, versionId: 9999, qaTestAudioEnabled: true, qaAudioUri: QA_URI_FOR_TESTS });
    expect(r.availability.status).toBe('UNAVAILABLE');
    expect(r.source).toBeNull();
  });

  it('the QA flag defaults OFF, so a build that does not set it cannot serve test audio', () => {
    expect(isQaTestAudioEnabled({})).toBe(false);
    expect(isQaTestAudioEnabled({ EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: undefined })).toBe(false);
    expect(isQaTestAudioEnabled({ EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: '' })).toBe(false);
    expect(isQaTestAudioEnabled({ EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: 'false' })).toBe(false);
    expect(isQaTestAudioEnabled({ EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: '0' })).toBe(false);
    expect(isQaTestAudioEnabled({ EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: 'yes' })).toBe(false);
  });

  it('only the exact literal true enables it, and only together with fixture mode', () => {
    expect(isQaTestAudioEnabled({ EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: 'true', EXPO_PUBLIC_QINGMU_FIXTURE: 'true' })).toBe(true);
    // a pilot build is not a fixture build, so even a stray flag cannot arm it
    expect(isQaTestAudioEnabled({ EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: 'true', EXPO_PUBLIC_QINGMU_FIXTURE: 'false' })).toBe(false);
    expect(isQaTestAudioEnabled({ EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: 'true' })).toBe(false);
  });

  it('never claims production recording access even when the QA source is serving', () => {
    const r = resolveChapterAudioSession({ chapterUsfm: QA_EVIDENCED_CHAPTER_USFM, versionId: QA_EVIDENCED_VERSION_ID, qaTestAudioEnabled: true, qaAudioUri: QA_URI_FOR_TESTS });
    expect(r.sourceClass).toBe('qa-test-only');
    expect(r.productionDeliveryEntitlement).toBe('UNRESOLVED');
    expect(r.availability.recordingId).toMatch(/poc-evidenced/);
  });
  it('renders nothing at all when no source resolved, so it cannot consume reader space', () => {
    // Measured on device in RC14m (ledger acc-20260911T050642Z, CAP-UX02-entry.xml): the PENDING
    // branch rendered a title plus two wrapped sentences, 91 dp of chrome, and that was exactly the
    // content clamped outside the controls viewport with inverted bounds. It was also redundant: the
    // reader's own content-status block already states 中文音訊狀態：等待Biblica授權與官方SDK能力核對。
    // visibly, and that visible line is what CAP-UX06's declared outcome is graded on. So when there
    // is no source there is nothing to show, and the audio area occupies no reader space.
    const production = resolveChapterAudioSession({ chapterUsfm: 'JHN.13', versionId: QA_EVIDENCED_VERSION_ID, qaTestAudioEnabled: false });
    expect(chapterAudioRenderMode(production)).toBe('NONE');

    const uncoveredChapter = resolveChapterAudioSession({ chapterUsfm: 'PSA.88', versionId: QA_EVIDENCED_VERSION_ID, qaTestAudioEnabled: true, qaAudioUri: QA_URI_FOR_TESTS });
    expect(chapterAudioRenderMode(uncoveredChapter)).toBe('NONE');

    const wrongVersion = resolveChapterAudioSession({ chapterUsfm: QA_EVIDENCED_CHAPTER_USFM, versionId: 1, qaTestAudioEnabled: true, qaAudioUri: QA_URI_FOR_TESTS });
    expect(chapterAudioRenderMode(wrongVersion)).toBe('NONE');
  });

  it('renders the player only on the one chapter the QA source genuinely covers', () => {
    const armed = resolveChapterAudioSession({ chapterUsfm: QA_EVIDENCED_CHAPTER_USFM, versionId: QA_EVIDENCED_VERSION_ID, qaTestAudioEnabled: true, qaAudioUri: QA_URI_FOR_TESTS });
    expect(chapterAudioRenderMode(armed)).toBe('PLAYER');
  });
  it('cannot serve a source when the build supplied no recording URI', () => {
    // Verified by unpacking a production APK: a hardcoded URI literal shipped the raw recording URL
    // inside the production bundle as dead code. The URI now comes from a build-time variable, and in
    // the unit environment it is unset, so even with the QA flags on there is nothing to serve.
    const r = resolveChapterAudioSession({ chapterUsfm: QA_EVIDENCED_CHAPTER_USFM, versionId: QA_EVIDENCED_VERSION_ID, qaTestAudioEnabled: true });
    expect(r.source).toBeNull();
    expect(r.availability.status).not.toBe('READY');
    expect(chapterAudioRenderMode(r)).toBe('NONE');
  });
});
