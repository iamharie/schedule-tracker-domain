import bcrypt from 'bcrypt';
import { GraphQLError } from 'graphql';
import { z } from 'zod';
import prisma from '../../config/prisma';
import { generateVerificationToken, hashToken } from '../../utils/crypto';
import { sendVerificationEmail } from '../../utils/email';

const BCRYPT_ROUNDS = 12;
const TOKEN_EXPIRY_HOURS = 24;
const RESEND_COOLDOWN_MS = 60_000;

// In-memory rate limiter — good enough for Phase 2; replace with Redis in production
const resendCooldowns = new Map<string, number>();

const USER_SAFE_SELECT = {
  id: true,
  email: true,
  timezone: true,
  isVerified: true,
  createdAt: true,
  updatedAt: true,
} as const;

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

function tokenExpiry(): Date {
  return new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
}

export async function register(email: string, password: string): Promise<true> {
  const parsed = registerSchema.safeParse({ email, password });
  if (!parsed.success) {
    throw new GraphQLError(parsed.error.errors[0]?.message ?? 'Validation error', {
      extensions: { code: 'VALIDATION_ERROR' },
    });
  }

  const normalizedEmail = parsed.data.email.toLowerCase().trim();
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (existingUser) return true; // Silently succeed — never reveal if email is taken

  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
  const { rawToken, tokenHash } = generateVerificationToken();

  await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      verificationTokens: {
        create: { tokenHash, expiresAt: tokenExpiry() },
      },
      calendars: {
        create: { name: 'Personal', color: '#4F46E5', isDefault: true },
      },
    },
  });

  sendVerificationEmail(normalizedEmail, rawToken).catch(console.error);
  return true;
}

export async function verifyEmail(rawToken: string) {
  const tokenHash = hashToken(rawToken);

  const record = await prisma.verificationToken.findFirst({
    where: {
      tokenHash,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!record) {
    throw new GraphQLError('Invalid or expired verification link', {
      extensions: { code: 'INVALID_TOKEN' },
    });
  }

  const user = await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return tx.user.update({
      where: { id: record.userId },
      data: { isVerified: true },
      select: USER_SAFE_SELECT,
    });
  });

  return user;
}

export async function login(email: string, password: string) {
  const parsed = loginSchema.safeParse({ email, password });
  if (!parsed.success) {
    throw new GraphQLError('Invalid email or password', {
      extensions: { code: 'INVALID_CREDENTIALS' },
    });
  }

  const normalizedEmail = parsed.data.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user) {
    throw new GraphQLError('Invalid email or password', {
      extensions: { code: 'INVALID_CREDENTIALS' },
    });
  }

  if (!user.isVerified) {
    throw new GraphQLError(
      'Email not verified. Check your inbox or request a new verification email.',
      { extensions: { code: 'NOT_VERIFIED' } },
    );
  }

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) {
    throw new GraphQLError('Invalid email or password', {
      extensions: { code: 'INVALID_CREDENTIALS' },
    });
  }

  return prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: USER_SAFE_SELECT,
  });
}

export async function resendVerification(email: string): Promise<true> {
  const normalizedEmail = email.toLowerCase().trim();

  // Rate-limit without revealing if email exists
  const lastSent = resendCooldowns.get(normalizedEmail);
  if (lastSent && Date.now() - lastSent < RESEND_COOLDOWN_MS) return true;

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, isVerified: true },
  });

  if (!user || user.isVerified) return true;

  // Invalidate existing unexpired tokens
  await prisma.verificationToken.updateMany({
    where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });

  const { rawToken, tokenHash } = generateVerificationToken();
  await prisma.verificationToken.create({
    data: { userId: user.id, tokenHash, expiresAt: tokenExpiry() },
  });

  resendCooldowns.set(normalizedEmail, Date.now());
  sendVerificationEmail(normalizedEmail, rawToken).catch(console.error);
  return true;
}
