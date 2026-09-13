import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildGroupContextModel, type GroupContextInput } from '../../src/ui/groupContext';

describe('My RPG group context state contract', () => {
  it('keeps meeting and roster projections consistent for generated states', () => {
    const text = fc.string({ minLength: 1, maxLength: 24 });
    const roster = fc.array(fc.record({ label: text, isSelf: fc.boolean() }), { maxLength: 8 });
    const meeting = fc.oneof(
      fc.constant(null),
      fc.record({
        title: text,
        startsAt: text,
        timeZone: fc.constant('Asia/Taipei'),
        revision: fc.integer({ min: 0, max: 1000 }),
        status: fc.constantFrom('SCHEDULED' as const, 'CANCELLED' as const),
      }),
    );
    const input: fc.Arbitrary<GroupContextInput> = fc.record({
      groupName: text,
      rpgName: text,
      callProvider: fc.option(fc.constantFrom('meet', 'zoom'), { nil: null }),
      callUrl: fc.option(text, { nil: null }),
      openChatUrl: fc.option(text, { nil: null }),
      meeting,
      roster: fc.option(roster, { nil: null }),
    });

    fc.assert(fc.property(input, (value) => {
      const model = buildGroupContextModel(value);
      const expectedMeetingLabel = value.meeting?.status === 'SCHEDULED' ? value.meeting.title : '尚未排定下一場聚會';
      expect(model.meetingLabel).toBe(expectedMeetingLabel);
      expect(model.meetingRevision).toBe(value.meeting?.status === 'SCHEDULED' ? value.meeting.revision : null);
      expect(model.maskedRosterCount).toBe(value.roster?.length ?? 0);
      expect(model.rosterLabels).toEqual(value.roster?.map((member) => member.label) ?? []);
      expect(model.hasLine).toBe(Boolean(value.openChatUrl));
      expect(model.hasCopyFallback).toBe(Boolean(value.callUrl || value.openChatUrl));
    }), { numRuns: 100 });
  });
});
