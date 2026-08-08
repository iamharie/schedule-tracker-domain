import { RRule } from 'rrule';
import type { Event, EventException, Priority } from '@prisma/client';

export type ExpandedEvent = {
  id: string;
  calendarId: string;
  title: string;
  notes: string | null;
  location: string | null;
  startsAt: Date;
  computedStartsAt: Date;
  durationMinutes: number;
  allDay: boolean;
  priority: Priority;
  isAnchored: boolean;
  sortOrder: string;
  rrule: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isOccurrence: boolean;
  originalEventId: string | null;
  occurrenceDate: Date | null;
};

/**
 * Expand a recurring event into individual occurrence objects within [start, end).
 * Exceptions can delete or override specific occurrences.
 */
export function expandOccurrences(
  event: Event,
  start: Date,
  end: Date,
  exceptions: EventException[],
): ExpandedEvent[] {
  if (!event.rrule) return [];

  const rule = new RRule({
    ...RRule.parseString(event.rrule),
    dtstart: event.startsAt,
  });

  const dates = rule.between(start, end, true).filter((d) => d >= start && d < end);

  const deletedMs = new Set(
    exceptions.filter((e) => e.isDeleted).map((e) => e.originalDate.getTime()),
  );
  const editedMap = new Map(
    exceptions.filter((e) => !e.isDeleted).map((e) => [e.originalDate.getTime(), e]),
  );

  return dates
    .filter((d) => !deletedMs.has(d.getTime()))
    .map((d): ExpandedEvent => {
      const exc = editedMap.get(d.getTime());
      const base: ExpandedEvent = {
        id: `${event.id}:${d.toISOString()}`,
        calendarId: event.calendarId,
        title: event.title,
        notes: event.notes,
        location: event.location,
        startsAt: d,
        computedStartsAt: d,
        durationMinutes: event.durationMinutes,
        allDay: event.allDay,
        priority: event.priority,
        isAnchored: event.isAnchored,
        sortOrder: event.sortOrder,
        rrule: event.rrule,
        completedAt: event.completedAt,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        isOccurrence: true,
        originalEventId: event.id,
        occurrenceDate: d,
      };

      if (!exc) return base;

      return {
        ...base,
        title: exc.title ?? base.title,
        notes: exc.notes ?? base.notes,
        location: exc.location ?? base.location,
        startsAt: exc.startsAt ?? base.startsAt,
        computedStartsAt: exc.startsAt ?? base.startsAt,
        durationMinutes: exc.durationMinutes ?? base.durationMinutes,
        priority: exc.priority ?? base.priority,
      };
    });
}

/**
 * Convert a plain Event row to an ExpandedEvent (not a recurrence occurrence).
 * computedStartsAt is initially set equal to startsAt; call withComputedStartTimes to derive it.
 */
export function toExpandedEvent(event: Event): ExpandedEvent {
  return {
    ...event,
    computedStartsAt: event.startsAt,
    isOccurrence: false,
    originalEventId: null,
    occurrenceDate: null,
  };
}

/**
 * For each calendar-day group in the list, derive computedStartsAt for flexible events.
 *
 * Algorithm per group (sorted by sort_order):
 *   - Anchored event: computedStartsAt = startsAt; advance cursor to startsAt + duration
 *   - Flexible event: computedStartsAt = cursor (or startsAt if no prior event set the cursor)
 */
export function withComputedStartTimes(events: ExpandedEvent[]): ExpandedEvent[] {
  // Group by calendarId + UTC date of startsAt
  const groups = new Map<string, ExpandedEvent[]>();
  for (const e of events) {
    const key = `${e.calendarId}:${e.startsAt.toISOString().slice(0, 10)}`;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }

  const result = new Map<string, Date>();

  for (const group of groups.values()) {
    group.sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0));

    let cursor: Date | null = null;

    for (const e of group) {
      if (e.isAnchored) {
        result.set(e.id, e.startsAt);
        cursor = addMinutes(e.startsAt, e.durationMinutes);
      } else {
        const computed = cursor ?? e.startsAt;
        result.set(e.id, computed);
        cursor = addMinutes(computed, e.durationMinutes);
      }
    }
  }

  return events.map((e) => ({
    ...e,
    computedStartsAt: result.get(e.id) ?? e.startsAt,
  }));
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}
