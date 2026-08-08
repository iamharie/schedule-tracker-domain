import type { AppContext } from '../../graphql/context';
import { requireAuth } from '../../utils/auth';
import * as calendarService from './calendar.service';

export const calendarResolvers = {
  Query: {
    calendars(_: unknown, __: unknown, ctx: AppContext) {
      const userId = requireAuth(ctx);
      return calendarService.getCalendars(userId);
    },
  },
  Mutation: {
    createCalendar(
      _: unknown,
      { input }: { input: { name: string; color?: string; isDefault?: boolean } },
      ctx: AppContext,
    ) {
      const userId = requireAuth(ctx);
      return calendarService.createCalendar(userId, input);
    },
    updateCalendar(
      _: unknown,
      { id, input }: { id: string; input: { name?: string; color?: string; isDefault?: boolean } },
      ctx: AppContext,
    ) {
      const userId = requireAuth(ctx);
      return calendarService.updateCalendar(userId, id, input);
    },
    deleteCalendar(_: unknown, { id }: { id: string }, ctx: AppContext) {
      const userId = requireAuth(ctx);
      return calendarService.deleteCalendar(userId, id);
    },
  },
};
