import prisma from '../../config/prisma';
import { setAuthCookies, clearAuthCookies, requireAuth } from '../../utils/auth';
import * as authService from './auth.service';
import type { AppContext } from '../../graphql/context';

const USER_SAFE_SELECT = {
  id: true,
  email: true,
  timezone: true,
  isVerified: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const authResolvers = {
  Query: {
    me: async (_parent: unknown, _args: unknown, ctx: AppContext) => {
      if (!ctx.userId) return null;
      return prisma.user.findUnique({
        where: { id: ctx.userId },
        select: USER_SAFE_SELECT,
      });
    },
  },

  Mutation: {
    register: async (
      _parent: unknown,
      args: { email: string; password: string },
    ) => authService.register(args.email, args.password),

    verifyEmail: async (
      _parent: unknown,
      args: { token: string },
      ctx: AppContext,
    ) => {
      const user = await authService.verifyEmail(args.token);
      setAuthCookies(ctx.res, user.id);
      return user;
    },

    login: async (
      _parent: unknown,
      args: { email: string; password: string },
      ctx: AppContext,
    ) => {
      const user = await authService.login(args.email, args.password);
      setAuthCookies(ctx.res, user.id);
      return user;
    },

    logout: async (_parent: unknown, _args: unknown, ctx: AppContext) => {
      clearAuthCookies(ctx.res);
      return true;
    },

    resendVerification: async (
      _parent: unknown,
      args: { email: string },
    ) => authService.resendVerification(args.email),
  },
};
