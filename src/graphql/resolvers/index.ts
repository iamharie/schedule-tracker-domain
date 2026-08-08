import { mergeResolvers } from '@graphql-tools/merge';
import { DateTimeScalar } from '../scalars/DateTime';
import { healthResolvers } from './health';
import { authResolvers } from '../../modules/auth/auth.resolvers';
import { calendarResolvers } from '../../modules/calendar/calendar.resolvers';
import { eventResolvers } from '../../modules/event/event.resolvers';

export const resolvers = mergeResolvers([
  { DateTime: DateTimeScalar },
  healthResolvers,
  authResolvers,
  calendarResolvers,
  eventResolvers,
]);
