import jwt from 'jsonwebtoken';
import { Response, Request } from 'express';
import { GraphQLError } from 'graphql';
import { env } from '../config/env';
import type { AppContext } from '../graphql/context';

const ACCESS_COOKIE = 'st_access';
const REFRESH_COOKIE = 'st_refresh';
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface JwtPayload {
  userId: string;
}

function cookieOptions(maxAgeMs: number) {
  const isProd = env.nodeEnv === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: maxAgeMs,
    path: '/',
  };
}

export function setAuthCookies(res: Response, userId: string): void {
  const accessToken = jwt.sign({ userId }, env.jwtAccessSecret, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId }, env.jwtRefreshSecret, { expiresIn: '7d' });
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TTL_MS));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_TTL_MS));
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
}

export async function resolveUserId(
  req: Request,
  res: Response,
): Promise<string | undefined> {
  const cookies = (req as any).cookies ?? {};

  const accessToken = cookies[ACCESS_COOKIE];
  if (accessToken) {
    try {
      const payload = jwt.verify(accessToken, env.jwtAccessSecret) as JwtPayload;
      return payload.userId;
    } catch {
      // Expired or invalid — fall through to refresh
    }
  }

  const refreshToken = cookies[REFRESH_COOKIE];
  if (!refreshToken) return undefined;

  try {
    const payload = jwt.verify(refreshToken, env.jwtRefreshSecret) as JwtPayload;
    // Rotate: issue a new access token
    const newAccess = jwt.sign({ userId: payload.userId }, env.jwtAccessSecret, {
      expiresIn: '15m',
    });
    res.cookie(ACCESS_COOKIE, newAccess, cookieOptions(ACCESS_TTL_MS));
    return payload.userId;
  } catch {
    return undefined;
  }
}

export function requireAuth(ctx: AppContext): string {
  if (!ctx.userId) {
    throw new GraphQLError('Not authenticated', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  return ctx.userId;
}
