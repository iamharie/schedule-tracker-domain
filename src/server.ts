import prisma from './config/prisma';
import { createApp } from './app';
import { env } from './config/env';

function validateEnv(): void {
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

async function main(): Promise<void> {
  validateEnv();

  await prisma.$connect();
  console.log('✅ Database connected');

  const { httpServer } = await createApp();

  httpServer.listen(env.port, () => {
    console.log(`✅ Server running on port ${env.port}`);
    console.log(`📡 GraphQL endpoint: http://localhost:${env.port}/graphql`);
  });
}

main().catch((err) => {
  console.error('❌ Server failed to start:', err);
  process.exit(1);
});
