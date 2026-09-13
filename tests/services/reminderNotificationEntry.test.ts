import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReminderNotificationController, bindReminderNotifications, type ReminderEntryAuth } from '../../src/services/reminderNotificationEntry';

const session = { memberId: 'member:a', sessionToken: 'session-a' };
const signedIn = (): ReminderEntryAuth => ({ status: 'signed-in', session, epoch: 1 });
const readingData = () => ({ kind: 'READING', memberId: 'member:a', reminderId: 'reading:member:a:2026-09-14', targetId: 'church-2026-09', taskDate: '2026-09-14', route: 'https://untrusted.invalid/ignore-me' });
const meetingData = () => ({ event: 'MEETING_REMINDER', memberId: 'member:a', reminderId: 'meeting:m1:2', meetingId: 'm1', scheduleRevision: 2, route: '/account' });
const notification = (data: unknown, id = 'notification-1') => ({ date: 1234, request: { identifier: id, content: { data } } });
const response = (data: unknown, id = 'notification-1') => ({ actionIdentifier: 'default', notification: notification(data, id) });
function fixture() {
  let auth = signedIn();
  let ready = true;
  const openReadingDate = vi.fn();
  const openMeeting = vi.fn();
  const validateLatest = vi.fn(async () => ({ valid: true, memberId: 'member:a', meetingId: 'm1', scheduleRevision: 2, status: 'SCHEDULED' as const }));
  const controller = createReminderNotificationController({ getAuth: () => auth, canNavigate: () => ready, defaultActionIdentifier: 'default', openReadingDate, openMeeting, validateLatest });
  return { controller, openReadingDate, openMeeting, validateLatest, setAuth: (value: ReminderEntryAuth) => { auth = value; }, setReady: (value: boolean) => { ready = value; } };
}
afterEach(() => vi.useRealTimers());

describe('owned reminder notification entry', () => {
  it('shows an owned valid reading reminder in foreground and opens its canonical date, ignoring supplied routes', async () => {
    const f = fixture();
    expect(await f.controller.handleForeground(notification(readingData()))).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true });
    expect(await f.controller.handleResponse(response(readingData()))).toBe('handled');
    expect(f.openReadingDate).toHaveBeenCalledExactlyOnceWith('2026-09-14');
    expect(f.openMeeting).not.toHaveBeenCalled();
  });

  it.each([
    { memberId: 'member:b' }, { taskDate: '2026-09-13' }, { taskDate: '2026-09-99' },
    { reminderId: 'reading:other' }, { targetId: 'another-plan' }, { kind: 'OTHER' },
  ])('rejects malformed, unplanned or foreign reading payload %j', async change => {
    const f = fixture();
    const data = { ...readingData(), ...change };
    expect(await f.controller.handleForeground(notification(data))).toMatchObject({ shouldShowBanner: false, shouldShowList: false });
    expect(await f.controller.handleResponse(response(data))).toBe('ignored');
    expect(f.openReadingDate).not.toHaveBeenCalled();
  });

  it('defers cold-start navigation until auth hydration and root navigation are ready', async () => {
    const f = fixture();
    f.setAuth({ status: 'hydrating', session: null, epoch: 0 });
    expect(await f.controller.handleResponse(response(readingData()))).toBe('deferred');
    f.setAuth(signedIn()); f.setReady(false);
    expect(await f.controller.handleResponse(response(readingData()))).toBe('deferred');
    f.setReady(true);
    expect(await f.controller.handleResponse(response(readingData()))).toBe('handled');
    expect(f.openReadingDate).toHaveBeenCalledOnce();
  });

  it.each(['signed-out'] as const)('does not present or navigate while %s', async status => {
    const f = fixture(); f.setAuth({ ...signedIn(), status });
    expect(await f.controller.handleForeground(notification(readingData()))).toMatchObject({ shouldShowBanner: false });
    expect(await f.controller.handleResponse(response(readingData()))).toBe('ignored');
    expect(f.openReadingDate).not.toHaveBeenCalled();
  });

  it('keeps an owned generic reminder visible after token expiry but defers navigation until sign-in', async () => {
    const f = fixture(); f.setAuth({ ...signedIn(), status: 'expired' });
    expect(await f.controller.handleForeground(notification(readingData()))).toMatchObject({ shouldShowBanner: true });
    expect(await f.controller.handleResponse(response(readingData()))).toBe('deferred');
    expect(f.openReadingDate).not.toHaveBeenCalled(); expect(f.validateLatest).not.toHaveBeenCalled();
    f.setAuth({ ...signedIn(), epoch: 2 });
    expect(await f.controller.handleResponse(response(readingData()))).toBe('handled');
    expect(f.openReadingDate).toHaveBeenCalledExactlyOnceWith('2026-09-14');
  });

  it('revalidates the meeting owner/revision before presentation and again before a tap', async () => {
    const f = fixture();
    expect(await f.controller.handleForeground(notification(meetingData()))).toMatchObject({ shouldShowBanner: true });
    expect(await f.controller.handleResponse(response(meetingData()))).toBe('handled');
    expect(f.validateLatest).toHaveBeenCalledTimes(2);
    expect(f.openMeeting).toHaveBeenCalledExactlyOnceWith('m1');
    expect(f.openReadingDate).not.toHaveBeenCalled();
  });

  it.each([
    { valid: false }, { status: 'CANCELLED' }, { scheduleRevision: 3 }, { meetingId: 'm2' },
    { memberId: undefined }, { memberId: 'member:b' },
  ])('fails closed on stale/cancelled/unowned meeting validation %j', async change => {
    const f = fixture(); f.validateLatest.mockResolvedValue({ valid: true, memberId: 'member:a', meetingId: 'm1', scheduleRevision: 2, status: 'SCHEDULED', ...change } as any);
    expect(await f.controller.handleResponse(response(meetingData()))).toBe('ignored');
    expect(f.openMeeting).not.toHaveBeenCalled();
  });

  it('refuses old local meeting notifications without an owner before validation', async () => {
    const f = fixture(); const { memberId: _owner, ...data } = meetingData();
    expect(await f.controller.handleResponse(response(data))).toBe('ignored');
    expect(f.validateLatest).not.toHaveBeenCalled();
  });

  it('ignores a valid response after an account switch', async () => {
    const f = fixture(); let resolve!: (value: any) => void;
    f.validateLatest.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = f.controller.handleResponse(response(meetingData(), 'old-meeting'));
    expect(resolve).toBeTypeOf('function');
    f.setAuth({ status: 'signed-in', session: { memberId: 'member:b', sessionToken: 'session-b' }, epoch: 2 });
    resolve({ valid: true, memberId: 'member:a', meetingId: 'm1', scheduleRevision: 2, status: 'SCHEDULED' });
    expect(await pending).toBe('ignored');
    expect(f.openMeeting).not.toHaveBeenCalled();
  });

  it('rechecks reading owner immediately before returning foreground presentation permission', async () => {
    const f = fixture();
    const pending = f.controller.handleForeground(notification(readingData()));
    f.setAuth({ status: 'signed-in', session: { memberId: 'member:b', sessionToken: 'session-b' }, epoch: 2 });
    expect(await pending).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
  });

  it('does not let a slow earlier meeting tap navigate after a newer reading tap', async () => {
    const f = fixture(); let resolve!: (value: any) => void;
    f.validateLatest.mockImplementation(() => new Promise(done => { resolve = done; }));
    const old = f.controller.handleResponse(response(meetingData(), 'old-meeting'));
    expect(await f.controller.handleResponse(response(readingData(), 'new-reading'))).toBe('handled');
    resolve({ valid: true, memberId: 'member:a', meetingId: 'm1', scheduleRevision: 2, status: 'SCHEDULED' });
    expect(await old).toBe('ignored');
    expect(f.openReadingDate).toHaveBeenCalledOnce(); expect(f.openMeeting).not.toHaveBeenCalled();
  });

  it('bounds foreground validation under Expo’s three-second handler deadline', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.validateLatest.mockImplementation(() => new Promise(() => {}));
    const pending = f.controller.handleForeground(notification(meetingData()));
    await vi.advanceTimersByTimeAsync(2500);
    expect(await pending).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
  });

  it('deduplicates the same native response and rejects non-default actions', async () => {
    const f = fixture();
    await f.controller.handleResponse(response(readingData()));
    await f.controller.handleResponse(response(readingData()));
    await f.controller.handleResponse({ ...response(readingData(), 'another'), actionIdentifier: 'arbitrary-action' });
    expect(f.openReadingDate).toHaveBeenCalledOnce();
  });
});

describe('notification lifecycle binding', () => {
  it('installs foreground/live/cold-start paths, resumes a deferred response once, and removes its listeners', async () => {
    const f = fixture(); f.setAuth({ status: 'hydrating', session: null, epoch: 0 });
    let last: any = response(readingData()); let listener!: (response: unknown) => void;
    const remove = vi.fn(); const clear = vi.fn(() => { last = null; }); const setHandler = vi.fn();
    const binding = bindReminderNotifications({ DEFAULT_ACTION_IDENTIFIER: 'default', setNotificationHandler: setHandler, addNotificationResponseReceivedListener: next => { listener = next; return { remove }; }, getLastNotificationResponse: () => last, clearLastNotificationResponse: clear }, f.controller);
    await binding.resume();
    expect(setHandler).toHaveBeenCalled();
    expect(setHandler.mock.calls[0][0].handleNotification).toBeTypeOf('function');
    expect(f.openReadingDate).not.toHaveBeenCalled();
    f.setAuth(signedIn()); await binding.resume();
    expect(f.openReadingDate).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce();
    listener(response(readingData())); await Promise.resolve();
    expect(f.openReadingDate).toHaveBeenCalledOnce();
    binding.dispose(); expect(remove).toHaveBeenCalledOnce(); expect(setHandler).toHaveBeenLastCalledWith(null);
  });
});
