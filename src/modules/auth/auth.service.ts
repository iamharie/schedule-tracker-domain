import bcrypt from 'bcrypt';
import { GraphQLError } from 'graphql';
import { z } from 'zod';
import prisma from '../../config/prisma';
import { generateVerificationToken, hashToken } from '../../utils/crypto';
import { sendVerificationEmail, sendPasswordResetEmail } from '../../utils/email';

const BCRYPT_ROUNDS = 12;
const TOKEN_EXPIRY_HOURS = 24;
const PASSWORD_RESET_EXPIRY_HOURS = 1;
const RESEND_COOLDOWN_MS = 60_000;

// In-memory rate limiter — good enough for Phase 2; replace with Redis in production
const resendCooldowns = new Map<string, number>();
const passwordResetCooldowns = new Map<string, number>();

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

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

function tokenExpiry(): Date {
  return new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
}

function passwordResetExpiry(): Date {
  return new Date(Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000);
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

export async function requestPasswordReset(email: string): Promise<true> {
  const normalizedEmail = email.toLowerCase().trim();

  // Rate-limit without revealing if the email exists
  const lastSent = passwordResetCooldowns.get(normalizedEmail);
  if (lastSent && Date.now() - lastSent < RESEND_COOLDOWN_MS) return true;

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (!user) return true; // Silently succeed — never reveal if the email is registered

  // Invalidate any existing unexpired reset links before issuing a new one
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });

  const { rawToken, tokenHash } = generateVerificationToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: passwordResetExpiry() },
  });

  passwordResetCooldowns.set(normalizedEmail, Date.now());
  sendPasswordResetEmail(normalizedEmail, rawToken).catch(console.error);
  return true;
}

export async function resetPassword(token: string, newPassword: string): Promise<true> {
  const parsed = resetPasswordSchema.safeParse({ token, newPassword });
  if (!parsed.success) {
    throw new GraphQLError(parsed.error.errors[0]?.message ?? 'Validation error', {
      extensions: { code: 'VALIDATION_ERROR' },
    });
  }

  const tokenHash = hashToken(parsed.data.token);
  const record = await prisma.passwordResetToken.findFirst({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
  });

  if (!record) {
    throw new GraphQLError('Invalid or expired reset link', {
      extensions: { code: 'INVALID_TOKEN' },
    });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
  ]);

  return true;
}
