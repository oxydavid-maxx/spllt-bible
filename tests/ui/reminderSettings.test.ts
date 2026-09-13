import { describe, expect, it } from 'vitest';

import { buildReminderSettingsModel } from '../../src/ui/reminderSettingsModel';

describe('reminder settings', () => {
  it('makes remote delivery gating and permission denial explicit', () => {
    expect(buildReminderSettingsModel({ readingEnabled: true, meetingEnabled: true, remoteDeliveryStatus: 'REMOTE_PENDING', permission: 'denied', readingTime: '08:00', meetingAdvanceMinutes: 30 })).toMatchObject({
      readingLabel: '讀經提醒已開啟',
      deliveryLabel: '聚會提醒等待遠端設定',
      permissionLabel: '通知權限被拒絕；其他功能仍可使用',
    });
  });

  it('makes startup readiness explicit while the authoritative snapshot is loading', () => {
    expect(buildReminderSettingsModel({ ready: false, readingEnabled: false, meetingEnabled: false, remoteDeliveryStatus: 'REMOTE_PENDING', permission: 'undetermined', readingTime: '08:00', meetingAdvanceMinutes: 30 })).toMatchObject({
      readinessLabel: '提醒設定讀取中；你的變更會在讀取完成後套用',
    });
  });

  it('distinguishes a pending intention from confirmed synchronization and retryable failure', () => {
    const input = { ready: true, saving: true, readingEnabled: false, meetingEnabled: false, remoteDeliveryStatus: 'REMOTE_PENDING' as const, permission: 'granted' as const, readingTime: '08:00', meetingAdvanceMinutes: 30 };
    expect(buildReminderSettingsModel(input).readinessLabel).toBe('提醒設定儲存中…');
    expect(buildReminderSettingsModel({ ...input, saving: false }).readinessLabel).toBe('提醒設定已同步');
    expect(buildReminderSettingsModel({ ...input, error: 'save' }).readinessLabel).not.toBe('提醒設定已同步');
  });
});
