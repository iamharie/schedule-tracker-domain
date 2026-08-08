import crypto from 'crypto';

export function generateVerificationToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashToken(rawToken) };
}

// SHA-256 is appropriate here: tokens are already high-entropy random values,
// so a fast hash is secure and avoids the latency of bcrypt per lookup.
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
