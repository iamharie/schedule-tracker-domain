import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app';
import prisma from '../config/prisma';
import * as cryptoUtils from '../utils/crypto';
import * as emailUtils from '../utils/email';
import type { Server } from 'http';

// Unique email per test run so parallel runs don't clash
const EMAIL = `test+${Date.now()}@example.com`;
const PASSWORD = 'ValidPass123';

let httpServer: Server;
let request: ReturnType<typeof supertest>;
let capturedToken = '';
let capturedResetToken = '';

const gql = (query: string, variables?: Record<string, unknown>) => ({
  query,
  variables,
});

beforeAll(async () => {
  // Capture the raw verification token instead of sending a real email
  vi.spyOn(emailUtils, 'sendVerificationEmail').mockImplementation(
    async (_email, rawToken) => {
      capturedToken = rawToken;
    },
  );
  vi.spyOn(emailUtils, 'sendPasswordResetEmail').mockImplementation(
    async (_email, rawToken) => {
      capturedResetToken = rawToken;
    },
  );

  const { httpServer: hs } = await createApp();
  httpServer = hs;
  request = supertest(httpServer);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
  httpServer.close();
  vi.restoreAllMocks();
});

describe('register', () => {
  it('returns true for a new email', async () => {
    const res = await request
      .post('/graphql')
      .send(gql('mutation { register(email: "' + EMAIL + '", password: "' + PASSWORD + '") }'));
    expect(res.status).toBe(200);
    expect(res.body.data?.register).toBe(true);
    expect(res.body.errors).toBeUndefined();
  });

  it('returns true for an already-registered email (no leak)', async () => {
    const res = await request
      .post('/graphql')
      .send(gql('mutation { register(email: "' + EMAIL + '", password: "' + PASSWORD + '") }'));
    expect(res.status).toBe(200);
    expect(res.body.data?.register).toBe(true);
  });

  it('rejects short passwords with VALIDATION_ERROR', async () => {
    const res = await request
      .post('/graphql')
      .send(gql('mutation { register(email: "new@example.com", password: "short") }'));
    expect(res.body.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');
  });
});

describe('login before verification', () => {
  it('rejects with NOT_VERIFIED', async () => {
    const res = await request
      .post('/graphql')
      .send(gql('mutation { login(email: "' + EMAIL + '", password: "' + PASSWORD + '") { id } }'));
    expect(res.body.errors?.[0]?.extensions?.code).toBe('NOT_VERIFIED');
  });
});

describe('verifyEmail', () => {
  it('rejects an invalid token', async () => {
    const res = await request
      .post('/graphql')
      .send(gql('mutation { verifyEmail(token: "badtoken") { id } }'));
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_TOKEN');
  });

  it('verifies with the captured token and returns the user', async () => {
    expect(capturedToken).toBeTruthy();
    const res = await request
      .post('/graphql')
      .send(
        gql(
          `mutation VerifyEmail($token: String!) { verifyEmail(token: $token) { id email isVerified } }`,
          { token: capturedToken },
        ),
      );
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data?.verifyEmail?.isVerified).toBe(true);
    expect(res.body.data?.verifyEmail?.email).toBe(EMAIL);
  });

  it('rejects the same token a second time (consumed)', async () => {
    const res = await request
      .post('/graphql')
      .send(
        gql(`mutation { verifyEmail(token: "${capturedToken}") { id } }`),
      );
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_TOKEN');
  });
});

describe('login after verification', () => {
  it('succeeds and sets auth cookies', async () => {
    const res = await request
      .post('/graphql')
      .send(
        gql(
          `mutation { login(email: "${EMAIL}", password: "${PASSWORD}") { id email isVerified } }`,
        ),
      );
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data?.login?.email).toBe(EMAIL);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects wrong password', async () => {
    const res = await request
      .post('/graphql')
      .send(
        gql(`mutation { login(email: "${EMAIL}", password: "WrongPass999") { id } }`),
      );
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('me query', () => {
  it('returns null when unauthenticated', async () => {
    const res = await request
      .post('/graphql')
      .send(gql('query { me { id } }'));
    expect(res.body.data?.me).toBeNull();
  });
});

describe('requestPasswordReset', () => {
  it('returns true and does not leak whether the email is registered', async () => {
    const res = await request
      .post('/graphql')
      .send(gql('mutation { requestPasswordReset(email: "no-such-user@example.com") }'));
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data?.requestPasswordReset).toBe(true);
  });

  it('returns true and issues a reset token for a real user', async () => {
    const res = await request
      .post('/graphql')
      .send(gql(`mutation { requestPasswordReset(email: "${EMAIL}") }`));
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data?.requestPasswordReset).toBe(true);
    expect(capturedResetToken).toBeTruthy();
  });
});

describe('resetPassword', () => {
  const NEW_PASSWORD = 'BrandNewPass456';

  it('rejects an invalid token', async () => {
    const res = await request
      .post('/graphql')
      .send(gql('mutation { resetPassword(token: "badtoken", newPassword: "BrandNewPass456") }'));
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_TOKEN');
  });

  it('rejects a short new password', async () => {
    const res = await request
      .post('/graphql')
      .send(
        gql(
          `mutation { resetPassword(token: "${capturedResetToken}", newPassword: "short") }`,
        ),
      );
    expect(res.body.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');
  });

  it('succeeds with the captured token', async () => {
    expect(capturedResetToken).toBeTruthy();
    const res = await request
      .post('/graphql')
      .send(
        gql(
          `mutation { resetPassword(token: "${capturedResetToken}", newPassword: "${NEW_PASSWORD}") }`,
        ),
      );
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data?.resetPassword).toBe(true);
  });

  it('rejects the same token a second time (consumed)', async () => {
    const res = await request
      .post('/graphql')
      .send(
        gql(
          `mutation { resetPassword(token: "${capturedResetToken}", newPassword: "AnotherPass789") }`,
        ),
      );
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_TOKEN');
  });

  it('logs in with the new password', async () => {
    const res = await request
      .post('/graphql')
      .send(
        gql(`mutation { login(email: "${EMAIL}", password: "${NEW_PASSWORD}") { id email } }`),
      );
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data?.login?.email).toBe(EMAIL);
  });

  it('rejects the old password', async () => {
    const res = await request
      .post('/graphql')
      .send(gql(`mutation { login(email: "${EMAIL}", password: "${PASSWORD}") { id } }`));
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_CREDENTIALS');
  });
});
