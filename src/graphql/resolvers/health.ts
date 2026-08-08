import { AppContext } from '../context';

export const healthResolvers = {
  Query: {
    health: (_parent: unknown, _args: unknown, _ctx: AppContext): string =>
      'OK',
  },
};
