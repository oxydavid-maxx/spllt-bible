// usage: tsx scripts/ios/make-friend-apns.ts <out.apns>
// Writes the exact payload server/friendPush.ts + server/apnsSender.ts send an iPhone when the fixture's
// second member adds the first, for `xcrun simctl push` (no Apple account involved).
import { writeFileSync } from 'node:fs';
import { createApnsSender } from '../../server/apnsSender';
import { friendAddedNotificationText } from '../../src/domain/friendNotificationText';

const [output] = process.argv.slice(2);
if (!output) { console.error('usage: tsx scripts/ios/make-friend-apns.ts <out.apns>'); process.exit(2); }
// JSON.stringify(note) is what node-apn itself sends (Notification.prototype.compile), and it is typed.
let compiled = '';
const sender = createApnsSender({ keyFile: 'unused', keyId: 'unused', teamId: 'unused', topic: 'org.qingmu.youth', production: false,
  provider: { send: async (note) => { compiled = JSON.stringify(note); return { sent: [{}], failed: [] }; }, shutdown: () => undefined } });
const data = { event: 'FRIEND_ADDED', friendMemberId: 'fixture:other', friendName: '測試成員乙' };
void sender.send('simulator', { ...friendAddedNotificationText(data.friendName), data: { ...data, kind: 'FRIEND_ADDED', memberId: 'fixture:self' }, collapseId: 'friend:fixture:other' })
  .then(() => { writeFileSync(output, JSON.stringify({ 'Simulator Target Bundle': 'org.qingmu.youth', ...JSON.parse(compiled) })); });
