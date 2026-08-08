import { mergeResolvers } from '@graphql-tools/merge';
import { DateTimeScalar } from '../scalars/DateTime';
import { healthResolvers } from './health';
import { authResolvers } from '../../modules/auth/auth.resolvers';

export const resolvers = mergeResolvers([
  { DateTime: DateTimeScalar },
  healthResolvers,
  authResolvers,
]);
