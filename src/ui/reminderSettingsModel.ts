export interface ReminderSettingsModelInput {
  ready?: boolean;
  error?: 'load' | 'save' | null;
  readingEnabled: boolean;
  meetingEnabled: boolean;
  remoteDeliveryStatus: 'LOCAL_ONLY' | 'REMOTE_PENDING' | 'REMOTE_READY';
  permission: 'granted' | 'denied' | 'undetermined';
  readingTime: string;
  meetingAdvanceMinutes: number;
}

export function buildReminderSettingsModel(input: ReminderSettingsModelInput) {
  return {
    readinessLabel: input.error === 'load' ? '無法讀取提醒設定，請重試。' : input.error === 'save' ? '尚未確認提醒設定已儲存，請重試。' : input.ready === false ? '提醒設定讀取中；你的變更會在讀取完成後套用' : '提醒設定已同步',
    readingLabel: input.readingEnabled ? '讀經提醒已開啟' : '讀經提醒未開啟',
    meetingLabel: input.meetingEnabled ? '聚會提醒已開啟' : '聚會提醒未開啟',
    deliveryLabel: input.remoteDeliveryStatus === 'REMOTE_READY'
      ? '聚會提醒已連接遠端 delivery'
      : input.remoteDeliveryStatus === 'REMOTE_PENDING'
        ? '聚會提醒等待遠端設定'
        : '目前只提供本機讀經提醒',
    permissionLabel: input.permission === 'denied' ? '通知權限被拒絕；其他功能仍可使用' : input.permission === 'granted' ? '通知權限已允許' : '啟用時才會詢問通知權限',
    readingTimeLabel: `每日讀經時間：${input.readingTime}`,
    meetingAdvanceLabel: `聚會提前提醒：${input.meetingAdvanceMinutes} 分鐘`,
  } as const;
}
