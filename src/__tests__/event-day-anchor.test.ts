import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '../config/prisma';
import * as eventService from '../modules/event/event.service';

// Regression test for: a fixed-time event created for "tomorrow" at an early
// local hour (e.g. 12:30 AM in a timezone ahead of UTC, like IST) has a raw
// `startsAt` whose UTC calendar date is one day *earlier* than the day the
// client actually intends. quickCreateEvent's `date` field is the client's
// unambiguous intended day — sortOrder must be resolved against THAT day's
// siblings, not a UTC slice of `startsAt`, or the new event gets sandwiched
// among the wrong day's events.

const EMAIL = `day-anchor-test+${Date.now()}@example.com`;
let userId: string;
let calendarId: string;
const createdEventIds: string[] = [];

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      passwordHash: 'not-a-real-hash',
      isVerified: true,
      calendars: { create: { name: 'Test', color: '#4F46E5', isDefault: true } },
    },
    include: { calendars: true },
  });
  userId = user.id;
  calendarId = user.calendars[0].id;
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('quickCreateEvent day-anchor (UTC vs local day-boundary)', () => {
  it('resolves sortOrder against the client-intended day, not a UTC slice of startsAt', async () => {
    // A normal sibling genuinely on "tomorrow" (Aug 10), created with no edge case.
    const tomorrowSibling = await eventService.quickCreateEvent(userId, {
      title: 'sibling-tomorrow',
      date: new Date('2026-08-10T00:00:00.000Z'),
      calendarId,
    });
    createdEventIds.push(tomorrowSibling.id);

    // A sibling on "today" (Aug 9) — populates the UTC-Aug-9 bucket that the
    // bug would have incorrectly matched the midnight event against.
    const todaySibling = await eventService.quickCreateEvent(userId, {
      title: 'sibling-today',
      date: new Date('2026-08-09T00:00:00.000Z'),
      calendarId,
    });
    createdEventIds.push(todaySibling.id);

    // The midnight-anchored event: client intends "tomorrow" (date field),
    // but its precise instant (00:30 IST = 19:00 UTC the day before) has a
    // UTC calendar date of "today".
    const midnightEvent = await eventService.quickCreateEvent(userId, {
      title: 'midnight-event',
      date: new Date('2026-08-10T00:00:00.000Z'),
      startsAt: new Date('2026-08-09T19:00:00.000Z'),
      calendarId,
      isAnchored: true,
    });
    createdEventIds.push(midnightEvent.id);

    // Must be appended after tomorrow's sibling — proves it was resolved
    // against the Aug-10 bucket (the client's intended day), not Aug-9.
    expect(midnightEvent.sortOrder > tomorrowSibling.sortOrder).toBe(true);

    // Its own display time must still reflect the exact instant requested.
    expect(midnightEvent.computedStartsAt.toISOString()).toBe('2026-08-09T19:00:00.000Z');

    // Sanity: today's sibling is unaffected and keeps its own value.
    expect(todaySibling.title).toBe('sibling-today');
  });
});
