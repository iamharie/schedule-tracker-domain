import { describe, it, expect } from 'vitest';
import { expandOccurrences, withComputedStartTimes, toExpandedEvent } from '../utils/recurrence';
import type { Event, EventException, Priority } from '@prisma/client';

// Minimal Event factory
function makeEvent(overrides: Partial<Event> = {}): Event {
  const now = new Date('2026-01-01T09:00:00Z');
  return {
    id: 'evt-1',
    calendarId: 'cal-1',
    title: 'Test Event',
    notes: null,
    location: null,
    startsAt: now,
    durationMinutes: 60,
    allDay: false,
    priority: 'MEDIUM' as Priority,
    isAnchored: false,
    sortOrder: '0001000.000000',
    rrule: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('expandOccurrences', () => {
  it('returns empty array for a non-recurring event', () => {
    const event = makeEvent({ rrule: null });
    const result = expandOccurrences(event, new Date('2026-01-01'), new Date('2026-01-31'), []);
    expect(result).toHaveLength(0);
  });

  it('expands a weekly event into correct number of occurrences', () => {
    const event = makeEvent({
      startsAt: new Date('2026-01-05T09:00:00Z'), // Monday
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-02-01T00:00:00Z');
    const result = expandOccurrences(event, start, end, []);
    // Mondays in Jan 2026: 5, 12, 19, 26
    expect(result).toHaveLength(4);
    expect(result[0]!.startsAt.toISOString()).toContain('2026-01-05');
    expect(result[3]!.startsAt.toISOString()).toContain('2026-01-26');
  });

  it('excludes occurrences outside [start, end)', () => {
    const event = makeEvent({
      startsAt: new Date('2026-01-01T09:00:00Z'),
      rrule: 'FREQ=DAILY',
    });
    const start = new Date('2026-01-05T00:00:00Z');
    const end = new Date('2026-01-08T00:00:00Z');
    const result = expandOccurrences(event, start, end, []);
    // Should include 5, 6, 7 (not 8)
    expect(result).toHaveLength(3);
    expect(result[0]!.startsAt.toISOString()).toContain('2026-01-05');
    expect(result[2]!.startsAt.toISOString()).toContain('2026-01-07');
  });

  it('skips deleted exceptions', () => {
    const event = makeEvent({
      startsAt: new Date('2026-01-05T09:00:00Z'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const deletedDate = new Date('2026-01-12T09:00:00Z');
    const exception: EventException = {
      id: 'exc-1',
      eventId: event.id,
      originalDate: deletedDate,
      isDeleted: true,
      title: null,
      notes: null,
      location: null,
      startsAt: null,
      durationMinutes: null,
      priority: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = expandOccurrences(
      event,
      new Date('2026-01-01'),
      new Date('2026-02-01'),
      [exception],
    );
    expect(result).toHaveLength(3);
    expect(result.some((e) => e.startsAt.getTime() === deletedDate.getTime())).toBe(false);
  });

  it('applies field overrides from non-deleted exceptions', () => {
    const event = makeEvent({
      startsAt: new Date('2026-01-05T09:00:00Z'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const originalDate = new Date('2026-01-12T09:00:00Z');
    const exception: EventException = {
      id: 'exc-2',
      eventId: event.id,
      originalDate,
      isDeleted: false,
      title: 'Overridden Title',
      notes: null,
      location: null,
      startsAt: new Date('2026-01-12T10:00:00Z'),
      durationMinutes: 90,
      priority: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = expandOccurrences(
      event,
      new Date('2026-01-01'),
      new Date('2026-02-01'),
      [exception],
    );
    const edited = result.find((e) => e.occurrenceDate?.getTime() === originalDate.getTime());
    expect(edited?.title).toBe('Overridden Title');
    expect(edited?.durationMinutes).toBe(90);
    expect(edited?.startsAt.toISOString()).toContain('T10:00:00');
  });

  it('sets isOccurrence=true and originalEventId on all occurrences', () => {
    const event = makeEvent({ rrule: 'FREQ=DAILY' });
    const result = expandOccurrences(
      event,
      new Date('2026-01-01'),
      new Date('2026-01-04'),
      [],
    );
    for (const occ of result) {
      expect(occ.isOccurrence).toBe(true);
      expect(occ.originalEventId).toBe(event.id);
    }
  });
});

describe('withComputedStartTimes', () => {
  function makeExpanded(overrides: Partial<Event> = {}) {
    return toExpandedEvent(makeEvent(overrides));
  }

  it('anchored events keep startsAt as computedStartsAt', () => {
    const e = makeExpanded({ isAnchored: true, startsAt: new Date('2026-01-01T09:00:00Z') });
    const [result] = withComputedStartTimes([e]);
    expect(result!.computedStartsAt.toISOString()).toBe('2026-01-01T09:00:00.000Z');
  });

  it('first flexible event uses its own startsAt as the cursor seed', () => {
    const e = makeExpanded({ isAnchored: false, startsAt: new Date('2026-01-01T09:00:00Z') });
    const [result] = withComputedStartTimes([e]);
    expect(result!.computedStartsAt.toISOString()).toBe('2026-01-01T09:00:00.000Z');
  });

  it('flexible events stack after an anchored event', () => {
    const anchored = makeExpanded({
      id: 'a',
      isAnchored: true,
      startsAt: new Date('2026-01-01T09:00:00Z'),
      durationMinutes: 60,
      sortOrder: '0001000.000000',
    });
    const flexible = makeExpanded({
      id: 'b',
      isAnchored: false,
      startsAt: new Date('2026-01-01T08:00:00Z'), // stale stored time
      durationMinutes: 30,
      sortOrder: '0002000.000000',
    });

    const [ra, rb] = withComputedStartTimes([anchored, flexible]);
    expect(ra!.computedStartsAt.toISOString()).toBe('2026-01-01T09:00:00.000Z');
    // Flexible starts after anchored ends: 09:00 + 60min = 10:00
    expect(rb!.computedStartsAt.toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('groups events by calendar-day independently', () => {
    const day1 = makeExpanded({
      id: 'c1',
      calendarId: 'cal-1',
      isAnchored: true,
      startsAt: new Date('2026-01-01T09:00:00Z'),
      durationMinutes: 60,
      sortOrder: '0001000.000000',
    });
    const day2 = makeExpanded({
      id: 'c2',
      calendarId: 'cal-1',
      isAnchored: false,
      startsAt: new Date('2026-01-02T08:00:00Z'),
      durationMinutes: 30,
      sortOrder: '0001000.000000',
    });

    const results = withComputedStartTimes([day1, day2]);
    const r1 = results.find((e) => e.id === 'c1')!;
    const r2 = results.find((e) => e.id === 'c2')!;

    // day1's anchored event keeps its time
    expect(r1.computedStartsAt.toISOString()).toBe('2026-01-01T09:00:00.000Z');
    // day2 is a separate day, flexible event uses its own startsAt
    expect(r2.computedStartsAt.toISOString()).toBe('2026-01-02T08:00:00.000Z');
  });
});
