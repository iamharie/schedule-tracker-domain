const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Required env var ${key} is not set`);
  return val;
};

export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  databaseUrl: required('DATABASE_URL'),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  // Phase 2 — will be promoted to required() when auth is added
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
  emailTransport: (process.env.EMAIL_TRANSPORT || 'console') as 'console' | 'resend' | 'smtp',
  emailFrom: process.env.EMAIL_FROM || 'noreply@schedule-tracker.local',
  resendApiKey: process.env.RESEND_API_KEY || '',
};
