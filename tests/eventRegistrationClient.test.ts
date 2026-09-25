import { describe, expect, it, vi } from 'vitest';
import { eventDateFromLabel, fetchEventRegistrations } from '../src/services/eventRegistrationClient';

describe('sign-ups for the next gathering', () => {
  it('turns the notice board date into the calendar date nearest today', () => {
    const now = new Date('2026-09-25T04:00:00Z');
    expect(eventDateFromLabel('9/27', now)).toBe('2026-09-27');
    expect(eventDateFromLabel('1/3', new Date('2026-12-28T04:00:00Z'))).toBe('2027-01-03');
    expect(eventDateFromLabel('下週', now)).toBeNull();
  });

  it('asks only for its own view and keeps only the fields it expects', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ date: '2026-09-27', total: 4, registered: true, friends: ['陳小華'], lineId: 'leak' }), { status: 200 }));
    const result = await fetchEventRegistrations({ baseUrl: 'https://api.example', token: 't', memberId: 'm', fetchImpl }, '2026-09-27');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example/api/me/event-registrations?date=2026-09-27', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer t', 'x-qingmu-member-id': 'm' }) }));
    expect(result).toEqual({ date: '2026-09-27', total: 4, registered: true, friends: ['陳小華'] });
  });

  it('shows nothing rather than an error when the server is unreachable or answers oddly', async () => {
    const down = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchEventRegistrations({ baseUrl: 'https://api.example', token: 't', memberId: 'm', fetchImpl: down }, '2026-09-27')).toBeNull();
    const odd = vi.fn(async () => new Response(JSON.stringify({ total: 'many' }), { status: 200 }));
    expect(await fetchEventRegistrations({ baseUrl: 'https://api.example', token: 't', memberId: 'm', fetchImpl: odd }, '2026-09-27')).toBeNull();
  });
});
