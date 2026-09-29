/**
 * The words of the "someone added you" notification. The same on both platforms: Android shows them from the
 * app (friendPush.ts presentFriendAddedNotification), and for iOS the server puts them in the APNs alert
 * (server/friendPush.ts), because the system, not the app, shows an iOS alert.
 */
export function friendAddedNotificationText(friendName: string): { title: string; body: string } {
  return { title: '竹科聖經', body: `${friendName} 已加你為好友` };
}
