import { describe, expect, it } from 'vitest';

import { buildGroupContextModel } from '../../src/ui/groupContext';

describe('My RPG group context', () => {
  it('identifies the RPG and next meeting before opening the provider', () => {
    expect(buildGroupContextModel({ groupName: 'A小組', rpgName: 'A-RPG1', callProvider: 'meet', callUrl: 'https://meet.google.com/test', openChatUrl: 'https://line.me/ti/g2/test', meeting: { title: '本週RPG', startsAt: '2026-09-12T19:00:00+08:00', timeZone: 'Asia/Taipei', revision: 3, status: 'SCHEDULED' }, roster: [{ label: '小明', isSelf: true }, { label: 'O工O', isSelf: false }] })).toMatchObject({ title: 'A小組 / A-RPG1', meetingLabel: '本週RPG', callLabel: '開啟 Meet 通話', hasLine: true, maskedRosterCount: 2 });
  });

  it('keeps missing schedule honest and exposes link recovery', () => {
    expect(buildGroupContextModel({ groupName: 'A小組', rpgName: 'A-RPG1', callProvider: 'meet', callUrl: 'https://meet.google.com/test', openChatUrl: 'https://line.me/ti/g2/test', meeting: null, roster: null })).toMatchObject({ meetingLabel: '尚未排定下一場聚會', hasCopyFallback: true, hasLine: true });
  });

  it('formats the configured meeting in Asia/Taipei and labels the timezone', () => {
    expect(buildGroupContextModel({ groupName: 'A小組', rpgName: 'A-RPG1', callProvider: 'meet', callUrl: 'https://meet.google.com/test', openChatUrl: 'https://line.me/ti/g2/test', meeting: { title: '本週RPG', startsAt: '2026-09-12T11:00:00.000Z', timeZone: 'Asia/Taipei', revision: 3, status: 'SCHEDULED' }, roster: null })).toMatchObject({ meetingDate: '2026/9/12（週六） 19:00（Asia/Taipei）', meetingTimeZone: 'Asia/Taipei' });
  });

  it('formats a Sunday meeting with the correct weekday label', () => {
    expect(buildGroupContextModel({ groupName: 'A小組', rpgName: 'A-RPG1', callProvider: 'meet', callUrl: 'https://meet.google.com/test', openChatUrl: 'https://line.me/ti/g2/test', meeting: { title: '本週RPG', startsAt: '2026-09-13T11:00:00.000Z', timeZone: 'Asia/Taipei', revision: 3, status: 'SCHEDULED' }, roster: null })).toMatchObject({ meetingDate: '2026/9/13（週日） 19:00（Asia/Taipei）' });
  });

  it('renders midnight in Asia/Taipei as 00:xx, not 24:xx', () => {
    expect(buildGroupContextModel({ groupName: 'A小組', rpgName: 'A-RPG1', callProvider: 'meet', callUrl: 'https://meet.google.com/test', openChatUrl: 'https://line.me/ti/g2/test', meeting: { title: '本週RPG', startsAt: '2026-09-12T16:00:00.000Z', timeZone: 'Asia/Taipei', revision: 3, status: 'SCHEDULED' }, roster: null })).toMatchObject({ meetingDate: '2026/9/13（週日） 00:00（Asia/Taipei）' });
  });

  it('keeps invalid schedule data in the explicit empty state', () => {
    expect(buildGroupContextModel({ groupName: 'A小組', rpgName: 'A-RPG1', callProvider: null, callUrl: null, openChatUrl: null, meeting: { title: '壞資料', startsAt: 'not-a-date', timeZone: 'Asia/Taipei', revision: 1, status: 'SCHEDULED' }, roster: null }).meetingDate).toBeNull();
    expect(buildGroupContextModel({ groupName: 'A小組', rpgName: 'A-RPG1', callProvider: null, callUrl: null, openChatUrl: null, meeting: { title: '壞時區', startsAt: '2026-09-12T11:00:00.000Z', timeZone: 'Invalid/Zone', revision: 1, status: 'SCHEDULED' }, roster: null }).meetingDate).toBeNull();
  });
});
