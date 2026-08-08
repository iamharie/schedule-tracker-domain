import { mergeResolvers } from '@graphql-tools/merge';
import { healthResolvers } from './health';

export const resolvers = mergeResolvers([healthResolvers]);
