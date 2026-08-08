import { env } from '../config/env';

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface EmailService {
  send(payload: EmailPayload): Promise<void>;
}

class ConsoleEmailService implements EmailService {
  async send({ to, subject, text }: EmailPayload): Promise<void> {
    console.log(
      ['\n📧 [EMAIL DEV]', `To: ${to}`, `Subject: ${subject}`, text, ''].join('\n'),
    );
  }
}

class ResendEmailService implements EmailService {
  async send(payload: EmailPayload): Promise<void> {
    const { Resend } = await import('resend');
    const client = new Resend(env.resendApiKey);
    await client.emails.send({
      from: env.emailFrom,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
  }
}

function createEmailService(): EmailService {
  if (env.emailTransport === 'resend') return new ResendEmailService();
  return new ConsoleEmailService();
}

const emailService = createEmailService();

export async function sendVerificationEmail(
  email: string,
  rawToken: string,
): Promise<void> {
  const link = `${env.appUrl}/verify-email?token=${rawToken}`;
  await emailService.send({
    to: email,
    subject: 'Verify your email — Schedule Tracker',
    text: `Verify your email by clicking this link:\n${link}\n\nThis link expires in 24 hours. If you didn't sign up, you can ignore this email.`,
    html: `
      <p>Thanks for signing up for Schedule Tracker.</p>
      <p><a href="${link}">Verify your email address</a></p>
      <p>This link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>
    `,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  rawToken: string,
): Promise<void> {
  const link = `${env.appUrl}/reset-password?token=${rawToken}`;
  await emailService.send({
    to: email,
    subject: 'Reset your password — Schedule Tracker',
    text: `Reset your password by clicking this link:\n${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `
      <p>We received a request to reset your Schedule Tracker password.</p>
      <p><a href="${link}">Reset your password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
    `,
  });
}
