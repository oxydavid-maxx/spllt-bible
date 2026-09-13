export interface GroupContextInput {
  groupName: string;
  rpgName: string;
  callProvider: string | null;
  callUrl: string | null;
  openChatUrl: string | null;
  meeting: {
    title: string;
    startsAt: string;
    timeZone: string;
    revision: number;
    status: 'SCHEDULED' | 'CANCELLED';
  } | null;
  roster: Array<{ label: string; isSelf: boolean }> | null;
}

export function buildGroupContextModel(input: GroupContextInput) {
  const scheduledMeeting = input.meeting?.status === 'SCHEDULED' ? input.meeting : null;
  const meetingDate = scheduledMeeting?.startsAt ? formatMeetingDate(scheduledMeeting.startsAt, scheduledMeeting.timeZone) : null;
  return {
    title: `${input.groupName} / ${input.rpgName}`,
    meetingLabel: scheduledMeeting?.title ?? '尚未排定下一場聚會',
    meetingDate,
    meetingTimeZone: scheduledMeeting?.timeZone ?? null,
    meetingRevision: scheduledMeeting?.revision ?? null,
    callLabel: input.callUrl ? `開啟 ${input.callProvider === 'meet' ? 'Meet' : input.callProvider ?? '外部'} 通話` : '通話入口待核准',
    hasLine: Boolean(input.openChatUrl),
    hasCopyFallback: Boolean(input.callUrl || input.openChatUrl),
    maskedRosterCount: input.roster?.length ?? 0,
    rosterLabels: input.roster?.map((member) => member.label) ?? [],
  } as const;
}

// Hermes on Android ships without zh-TW locale data and silently falls back to
// en-US, but it does honor the requested timeZone. So we always format in
// en-US and translate the weekday abbreviation ourselves via a fixed table,
// rather than trusting the runtime to render Chinese weekday names.
const WEEKDAY_LABELS: Record<string, string> = {
  Sun: '週日',
  Mon: '週一',
  Tue: '週二',
  Wed: '週三',
  Thu: '週四',
  Fri: '週五',
  Sat: '週六',
};

function formatMeetingDate(startsAt: string, timeZone: string): string | null {
  const date = new Date(startsAt);
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const lookup = new Map(parts.map((part) => [part.type, part.value]));
    const year = lookup.get('year');
    const month = lookup.get('month');
    const day = lookup.get('day');
    const hour = lookup.get('hour');
    const minute = lookup.get('minute');
    const weekdayName = lookup.get('weekday');
    const weekdayLabel = weekdayName ? WEEKDAY_LABELS[weekdayName] : undefined;
    if (!year || !month || !day || !hour || !minute || !weekdayLabel) return null;
    return `${year}/${month}/${day}（${weekdayLabel}） ${hour}:${minute}（${timeZone}）`;
  } catch {
    return null;
  }
}
