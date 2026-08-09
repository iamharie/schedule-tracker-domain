import { GraphQLError } from 'graphql';
import type { Priority, Prisma } from '@prisma/client';
import { RRule } from 'rrule';
import prisma from '../../config/prisma';
import { generateKeyBetween, INITIAL_SORT_KEY } from '../../utils/fractional-index';
import {
  expandOccurrences,
  toExpandedEvent,
  withComputedStartTimes,
  type ExpandedEvent,
} from '../../utils/recurrence';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function assertOwnsEvent(userId: string, eventId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, calendar: { userId } },
    select: { id: true, calendarId: true, startsAt: true },
  });
  if (!event) throw new GraphQLError('Event not found', { extensions: { code: 'NOT_FOUND' } });
  return event;
}

async function assertOwnsCalendar(userId: string, calendarId: string) {
  const cal = await prisma.calendar.findFirst({
    where: { id: calendarId, userId },
    select: { id: true },
  });
  if (!cal) throw new GraphQLError('Calendar not found', { extensions: { code: 'NOT_FOUND' } });
}

/**
 * Derive sort_order for a new event — append to end of its calendar-day, or
 * use given neighbours.
 *
 * `dayAnchor`, when provided, is used instead of `startsAt` to pick the day
 * bucket. This matters because "day" here is bucketed by UTC calendar date,
 * but `startsAt` is a precise instant — for a user ahead of UTC (e.g. IST),
 * a fixed-time event set for e.g. 12:30 AM local can have a UTC date that's
 * one day *earlier* than the local day the user actually picked. Without an
 * explicit anchor, such an event gets appended among the WRONG day's
 * siblings (typically "today", since that's what's usually populated) —
 * harmless when that day has no events yet (far-future dates), but producing
 * a bad sortOrder relative to today's real events otherwise. `dayAnchor`
 * should be an unambiguous calendar-day value the client already computed
 * from local time (see quickCreateEvent's `date` field), not derived from a
 * UTC slice of an instant.
 */
async function resolveSortOrder(
  calendarId: string,
  startsAt: Date,
  afterId?: string | null,
  beforeId?: string | null,
  dayAnchor?: Date | null,
): Promise<string> {
  if (afterId || beforeId) {
    const [after, before] = await Promise.all([
      afterId
        ? prisma.event.findUnique({ where: { id: afterId }, select: { sortOrder: true } })
        : null,
      beforeId
        ? prisma.event.findUnique({ where: { id: beforeId }, select: { sortOrder: true } })
        : null,
    ]);
    return generateKeyBetween(after?.sortOrder ?? null, before?.sortOrder ?? null);
  }

  // Append after the last event on this calendar-day (UTC)
  const dayStart = utcDayStart(dayAnchor ?? startsAt);
  const dayEnd = utcDayEnd(dayAnchor ?? startsAt);
  const last = await prisma.event.findFirst({
    where: { calendarId, startsAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  return generateKeyBetween(last?.sortOrder ?? null, null);
}

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function utcDayEnd(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

/**
 * Fetch a single event and annotate it with computedStartsAt from its
 * day-sequence. `dayAnchor` overrides which UTC day-bucket to pull siblings
 * from — see resolveSortOrder's comment for why this can differ from a UTC
 * slice of the event's own `startsAt`.
 */
async function eventWithComputed(eventId: string, dayAnchor?: Date | null): Promise<ExpandedEvent> {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const dayStart = utcDayStart(dayAnchor ?? event.startsAt);
  const dayEnd = utcDayEnd(dayAnchor ?? event.startsAt);

  const dayEvents = await prisma.event.findMany({
    where: { calendarId: event.calendarId, startsAt: { gte: dayStart, lt: dayEnd } },
  });

  const expanded = withComputedStartTimes(dayEvents.map(toExpandedEvent));
  return expanded.find((e) => e.id === eventId) ?? toExpandedEvent(event);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getEvents(
  userId: string,
  start: Date,
  end: Date,
  calendarIds?: string[] | null,
): Promise<ExpandedEvent[]> {
  const cals = await prisma.calendar.findMany({
    where: { userId, ...(calendarIds?.length ? { id: { in: calendarIds } } : {}) },
    select: { id: true },
  });
  const calIds = cals.map((c) => c.id);
  if (calIds.length === 0) return [];

  // Non-recurring events whose start falls in [start, end)
  const singles = await prisma.event.findMany({
    where: { calendarId: { in: calIds }, rrule: null, startsAt: { gte: start, lt: end } },
  });

  // Recurring event templates that started before the window closes
  const recurring = await prisma.event.findMany({
    where: { calendarId: { in: calIds }, rrule: { not: null }, startsAt: { lte: end } },
  });

  let occurrences: ExpandedEvent[] = [];

  if (recurring.length > 0) {
    const recurringIds = recurring.map((e) => e.id);
    const exceptions = await prisma.eventException.findMany({
      where: { eventId: { in: recurringIds } },
    });
    const excByEvent = new Map<string, typeof exceptions>();
    for (const exc of exceptions) {
      const list = excByEvent.get(exc.eventId) ?? [];
      list.push(exc);
      excByEvent.set(exc.eventId, list);
    }

    for (const event of recurring) {
      const excs = excByEvent.get(event.id) ?? [];
      occurrences = occurrences.concat(expandOccurrences(event, start, end, excs));
    }
  }

  const all = [...singles.map(toExpandedEvent), ...occurrences];
  return withComputedStartTimes(all);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createEvent(
  userId: string,
  input: {
    calendarId: string;
    title: string;
    notes?: string | null;
    location?: string | null;
    startsAt: Date;
    durationMinutes?: number | null;
    allDay?: boolean | null;
    priority?: Priority | null;
    isAnchored?: boolean | null;
    rrule?: string | null;
    afterId?: string | null;
    beforeId?: string | null;
    // Unambiguous intended calendar day, when the caller has one (quick
    // create does) — see resolveSortOrder's comment.
    dayAnchor?: Date | null;
  },
): Promise<ExpandedEvent> {
  await assertOwnsCalendar(userId, input.calendarId);

  const sortOrder = await resolveSortOrder(
    input.calendarId,
    input.startsAt,
    input.afterId,
    input.beforeId,
    input.dayAnchor,
  );

  const event = await prisma.event.create({
    data: {
      calendarId: input.calendarId,
      title: input.title,
      notes: input.notes,
      location: input.location,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes ?? 30,
      allDay: input.allDay ?? false,
      priority: input.priority ?? 'MEDIUM',
      isAnchored: input.isAnchored ?? false,
      sortOrder: sortOrder === null ? INITIAL_SORT_KEY : sortOrder,
      rrule: input.rrule,
    },
  });

  return eventWithComputed(event.id, input.dayAnchor);
}

export async function updateEvent(
  userId: string,
  id: string,
  input: {
    calendarId?: string | null;
    title?: string | null;
    notes?: string | null;
    location?: string | null;
    startsAt?: Date | null;
    durationMinutes?: number | null;
    allDay?: boolean | null;
    priority?: Priority | null;
    isAnchored?: boolean | null;
    rrule?: string | null;
    completedAt?: Date | null;
  },
  occurrenceDate?: Date | null,
  scope?: string | null,
): Promise<ExpandedEvent> {
  const event = await assertOwnsEvent(userId, id);

  const effectiveScope = scope ?? 'ALL_EVENTS';

  // Non-recurring or ALL_EVENTS: update the base row directly
  if (!event || effectiveScope === 'ALL_EVENTS') {
    if (input.calendarId) await assertOwnsCalendar(userId, input.calendarId);

    await prisma.event.update({
      where: { id },
      data: {
        ...(input.calendarId != null && { calendarId: input.calendarId }),
        ...(input.title != null && { title: input.title }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.startsAt != null && { startsAt: input.startsAt }),
        ...(input.durationMinutes != null && { durationMinutes: input.durationMinutes }),
        ...(input.allDay != null && { allDay: input.allDay }),
        ...(input.priority != null && { priority: input.priority }),
        ...(input.isAnchored != null && { isAnchored: input.isAnchored }),
        ...(input.rrule !== undefined && { rrule: input.rrule }),
        ...(input.completedAt !== undefined && { completedAt: input.completedAt }),
      },
    });

    return eventWithComputed(id);
  }

  if (!occurrenceDate) {
    throw new GraphQLError('occurrenceDate required for THIS_EVENT / THIS_AND_FUTURE scope', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  if (effectiveScope === 'THIS_EVENT') {
    // Upsert an exception for this specific occurrence
    await prisma.eventException.upsert({
      where: { eventId_originalDate: { eventId: id, originalDate: occurrenceDate } },
      create: {
        eventId: id,
        originalDate: occurrenceDate,
        title: input.title ?? undefined,
        notes: input.notes ?? undefined,
        location: input.location ?? undefined,
        startsAt: input.startsAt ?? undefined,
        durationMinutes: input.durationMinutes ?? undefined,
        priority: input.priority ?? undefined,
      },
      update: {
        ...(input.title != null && { title: input.title }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.startsAt != null && { startsAt: input.startsAt }),
        ...(input.durationMinutes != null && { durationMinutes: input.durationMinutes }),
        ...(input.priority != null && { priority: input.priority }),
        isDeleted: false,
      },
    });

    // Return the occurrence as it would appear after expansion
    const base = await prisma.event.findUniqueOrThrow({ where: { id } });
    const exc = await prisma.eventException.findUnique({
      where: { eventId_originalDate: { eventId: id, originalDate: occurrenceDate } },
    });
    const [expanded] = expandOccurrences(base, occurrenceDate, new Date(occurrenceDate.getTime() + 1), exc ? [exc] : []);
    return expanded ?? toExpandedEvent(base);
  }

  // THIS_AND_FUTURE: truncate the original RRULE with UNTIL and create a new event
  if (effectiveScope === 'THIS_AND_FUTURE') {
    const base = await prisma.event.findUniqueOrThrow({ where: { id } });
    if (!base.rrule) throw new GraphQLError('Event is not recurring', { extensions: { code: 'BAD_USER_INPUT' } });

    const parsed = RRule.parseString(base.rrule);
    const until = new Date(occurrenceDate.getTime() - 1);
    const updatedRrule = new RRule({ ...parsed, until }).toString().replace(/^RRULE:/, '');

    await prisma.$transaction(async (tx) => {
      // Truncate original
      await tx.event.update({ where: { id }, data: { rrule: updatedRrule } });
      // Remove exceptions on or after the split date from the original
      await tx.eventException.deleteMany({
        where: { eventId: id, originalDate: { gte: occurrenceDate } },
      });
    });

    // Create new event starting from this occurrence
    const newEvent = await prisma.event.create({
      data: {
        calendarId: input.calendarId ?? base.calendarId,
        title: input.title ?? base.title,
        notes: input.notes !== undefined ? input.notes : base.notes,
        location: input.location !== undefined ? input.location : base.location,
        startsAt: input.startsAt ?? occurrenceDate,
        durationMinutes: input.durationMinutes ?? base.durationMinutes,
        allDay: input.allDay ?? base.allDay,
        priority: input.priority ?? base.priority,
        isAnchored: input.isAnchored ?? base.isAnchored,
        sortOrder: base.sortOrder,
        rrule: input.rrule !== undefined ? input.rrule : base.rrule,
      },
    });

    return eventWithComputed(newEvent.id);
  }

  throw new GraphQLError('Invalid scope', { extensions: { code: 'BAD_USER_INPUT' } });
}

export async function deleteEvent(
  userId: string,
  id: string,
  occurrenceDate?: Date | null,
  scope?: string | null,
): Promise<boolean> {
  await assertOwnsEvent(userId, id);

  const effectiveScope = scope ?? 'ALL_EVENTS';

  if (effectiveScope === 'ALL_EVENTS') {
    await prisma.event.delete({ where: { id } });
    return true;
  }

  if (!occurrenceDate) {
    throw new GraphQLError('occurrenceDate required for THIS_EVENT / THIS_AND_FUTURE scope', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  if (effectiveScope === 'THIS_EVENT') {
    await prisma.eventException.upsert({
      where: { eventId_originalDate: { eventId: id, originalDate: occurrenceDate } },
      create: { eventId: id, originalDate: occurrenceDate, isDeleted: true },
      update: { isDeleted: true },
    });
    return true;
  }

  if (effectiveScope === 'THIS_AND_FUTURE') {
    const base = await prisma.event.findUniqueOrThrow({ where: { id } });
    if (!base.rrule) {
      await prisma.event.delete({ where: { id } });
      return true;
    }

    const parsed = RRule.parseString(base.rrule);
    const until = new Date(occurrenceDate.getTime() - 1);
    const updatedRrule = new RRule({ ...parsed, until }).toString().replace(/^RRULE:/, '');

    await prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id }, data: { rrule: updatedRrule } });
      await tx.eventException.deleteMany({
        where: { eventId: id, originalDate: { gte: occurrenceDate } },
      });
    });

    return true;
  }

  throw new GraphQLError('Invalid scope', { extensions: { code: 'BAD_USER_INPUT' } });
}

export async function quickCreateEvent(
  userId: string,
  input: {
    title: string;
    date: Date;
    calendarId?: string | null;
    durationMinutes?: number | null;
    priority?: Priority | null;
    isAnchored?: boolean | null;
    startsAt?: Date | null;
  },
): Promise<ExpandedEvent> {
  // Resolve calendar: use provided id, or user's default, or first calendar
  let calendarId = input.calendarId;
  if (!calendarId) {
    const cal =
      (await prisma.calendar.findFirst({ where: { userId, isDefault: true }, select: { id: true } })) ??
      (await prisma.calendar.findFirst({ where: { userId }, select: { id: true } }));
    if (!cal) throw new GraphQLError('No calendar found. Create a calendar first.', { extensions: { code: 'NOT_FOUND' } });
    calendarId = cal.id;
  }

  // Use provided startsAt, or fall back to the date argument (start of that UTC day)
  const startsAt = input.startsAt ?? input.date;

  return createEvent(userId, {
    calendarId,
    title: input.title,
    startsAt,
    durationMinutes: input.durationMinutes,
    priority: input.priority,
    isAnchored: input.isAnchored,
    // `date` is the day the client's UI actually shows this event under,
    // computed from local time — always prefer it over deriving the day
    // from `startsAt`'s UTC slice, which can disagree by one day.
    dayAnchor: input.date,
  });
}

export async function reorderEvent(
  userId: string,
  id: string,
  afterId?: string | null,
  beforeId?: string | null,
  startsAt?: Date,
): Promise<ExpandedEvent[]> {
  const eventMeta = await assertOwnsEvent(userId, id);

  const [after, before] = await Promise.all([
    afterId ? prisma.event.findFirst({ where: { id: afterId, calendar: { userId } }, select: { sortOrder: true } }) : null,
    beforeId ? prisma.event.findFirst({ where: { id: beforeId, calendar: { userId } }, select: { sortOrder: true } }) : null,
  ]);

  const newSortOrder = generateKeyBetween(after?.sortOrder ?? null, before?.sortOrder ?? null);

  // `startsAt`, when provided, moves the event to a different day (e.g. a
  // month-view drop on another day) — the client computes the correct local
  // instant, same as quick-create does. Sort order and the day move land in
  // one write so a cross-day drag can never be seen mid-move with a stale
  // sort key before the reorder "catches up".
  const newStartsAt = startsAt ?? eventMeta.startsAt;

  await prisma.event.update({
    where: { id },
    data: { sortOrder: newSortOrder, startsAt: newStartsAt },
  });

  // Return all events for the same calendar-day so the client can reconcile
  const dayStart = utcDayStart(newStartsAt);
  const dayEnd = utcDayEnd(newStartsAt);
  const dayEvents = await prisma.event.findMany({
    where: { calendarId: eventMeta.calendarId, startsAt: { gte: dayStart, lt: dayEnd } },
  });

  return withComputedStartTimes(dayEvents.map(toExpandedEvent));
}

export async function toggleEventComplete(userId: string, id: string): Promise<ExpandedEvent> {
  await assertOwnsEvent(userId, id);
  const event = await prisma.event.findUniqueOrThrow({ where: { id }, select: { completedAt: true } });

  await prisma.event.update({
    where: { id },
    data: { completedAt: event.completedAt ? null : new Date() },
  });

  return eventWithComputed(id);
}
