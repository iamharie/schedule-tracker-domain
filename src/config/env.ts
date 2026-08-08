export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  databaseUrl: process.env.DATABASE_URL || '',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
  emailTransport: (process.env.EMAIL_TRANSPORT || 'console') as 'console' | 'resend' | 'smtp',
  emailFrom: process.env.EMAIL_FROM || 'noreply@schedule-tracker.local',
  resendApiKey: process.env.RESEND_API_KEY || '',
};
