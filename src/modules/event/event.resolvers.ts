import type { AppContext } from '../../graphql/context';
import { requireAuth } from '../../utils/auth';
import type { Priority } from '@prisma/client';
import * as eventService from './event.service';

type CreateEventInput = {
  calendarId: string;
  title: string;
  notes?: string;
  location?: string;
  startsAt: string;
  durationMinutes?: number;
  allDay?: boolean;
  priority?: Priority;
  isAnchored?: boolean;
  rrule?: string;
  afterId?: string;
  beforeId?: string;
};

type UpdateEventInput = {
  calendarId?: string;
  title?: string;
  notes?: string;
  location?: string;
  startsAt?: string;
  durationMinutes?: number;
  allDay?: boolean;
  priority?: Priority;
  isAnchored?: boolean;
  rrule?: string;
  completedAt?: string;
};

type QuickCreateInput = {
  title: string;
  date: string;
  calendarId?: string;
  durationMinutes?: number;
  priority?: Priority;
  isAnchored?: boolean;
  startsAt?: string;
};

export const eventResolvers = {
  Query: {
    events(
      _: unknown,
      { start, end, calendarIds }: { start: Date; end: Date; calendarIds?: string[] },
      ctx: AppContext,
    ) {
      const userId = requireAuth(ctx);
      return eventService.getEvents(userId, start, end, calendarIds);
    },
  },
  Mutation: {
    createEvent(_: unknown, { input }: { input: CreateEventInput }, ctx: AppContext) {
      const userId = requireAuth(ctx);
      return eventService.createEvent(userId, {
        ...input,
        startsAt: new Date(input.startsAt),
      });
    },
    updateEvent(
      _: unknown,
      {
        id,
        input,
        occurrenceDate,
        scope,
      }: { id: string; input: UpdateEventInput; occurrenceDate?: string; scope?: string },
      ctx: AppContext,
    ) {
      const userId = requireAuth(ctx);
      return eventService.updateEvent(
        userId,
        id,
        {
          ...input,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
          completedAt: input.completedAt !== undefined ? (input.completedAt ? new Date(input.completedAt) : null) : undefined,
        },
        occurrenceDate ? new Date(occurrenceDate) : undefined,
        scope,
      );
    },
    deleteEvent(
      _: unknown,
      { id, occurrenceDate, scope }: { id: string; occurrenceDate?: string; scope?: string },
      ctx: AppContext,
    ) {
      const userId = requireAuth(ctx);
      return eventService.deleteEvent(userId, id, occurrenceDate ? new Date(occurrenceDate) : undefined, scope);
    },
    quickCreateEvent(_: unknown, { input }: { input: QuickCreateInput }, ctx: AppContext) {
      const userId = requireAuth(ctx);
      return eventService.quickCreateEvent(userId, {
        ...input,
        date: new Date(input.date),
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      });
    },
    reorderEvent(
      _: unknown,
      { id, afterId, beforeId }: { id: string; afterId?: string; beforeId?: string },
      ctx: AppContext,
    ) {
      const userId = requireAuth(ctx);
      return eventService.reorderEvent(userId, id, afterId, beforeId);
    },
    toggleEventComplete(_: unknown, { id }: { id: string }, ctx: AppContext) {
      const userId = requireAuth(ctx);
      return eventService.toggleEventComplete(userId, id);
    },
  },
};
