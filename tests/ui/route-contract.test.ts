import { describe, expect, it } from 'vitest';
import {
  appRoutes,
  buildFixtureModels,
  initialRoute,
  type UiContentState,
} from '../../src/ui/routes';

describe('native app route contract', () => {
  it('exposes four focused routes and the exact 9/8 reading passages', () => {
    expect(appRoutes).toEqual(['today', 'reader', 'progress', 'groups']);
    expect(initialRoute).toBe('/(tabs)/today');
    const models = buildFixtureModels();
    expect(models.today.date).toBe('2026-09-08');
    expect(models.today.references).toEqual(['JHN.18', 'JHN.19']);
    expect(models.reader.references).toEqual(['JHN.18', 'JHN.19']);
  });

  it('keeps the text probe state, masks peers, and does not expose redemption UI', () => {
    const models = buildFixtureModels();
    expect(models.reader.content.status satisfies UiContentState).toBe('C_TECHNICAL_PROBE');
    expect(models.reader.mode).toBe('c-probe');
    expect(models.progress.members).toEqual([
      { id: 'fixture:self', label: '小明', isSelf: true, status: 'COMPLETED' },
      { id: 'fixture:other', label: 'O小O', isSelf: false, status: 'UNREPORTED' },
    ]);
    expect(models.progress).not.toHaveProperty('redemption');
    expect(models.groups.openChatUrl).toBeNull();
    expect(models.groups.callProvider).toBe('meet');
    expect(models.groups.callScope).toBe('TEST_ONLY');
    expect(models.groups.callUrl).toBe('https://meet.google.com/nyv-basx-ivu');
    expect(models.groups.linkStatus).toBe('READY');
  });
});
