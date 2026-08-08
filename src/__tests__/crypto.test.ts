import { describe, it, expect } from 'vitest';
import { generateVerificationToken, hashToken } from '../utils/crypto';

describe('generateVerificationToken', () => {
  it('returns a 64-char hex raw token', () => {
    const { rawToken } = generateVerificationToken();
    expect(rawToken).toHaveLength(64);
    expect(rawToken).toMatch(/^[a-f0-9]+$/);
  });

  it('returns a 64-char hex token hash', () => {
    const { tokenHash } = generateVerificationToken();
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).toMatch(/^[a-f0-9]+$/);
  });

  it('raw token and hash are different', () => {
    const { rawToken, tokenHash } = generateVerificationToken();
    expect(rawToken).not.toBe(tokenHash);
  });

  it('produces unique tokens on every call', () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe('hashToken', () => {
  it('is deterministic', () => {
    const raw = 'deadbeef1234';
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('def'));
  });

  it('never returns the raw value', () => {
    const raw = 'somesecrettoken';
    expect(hashToken(raw)).not.toBe(raw);
  });
});
