import { Client } from 'pg';
import { createApp } from './app';
import { env } from './config/env';

async function verifyDbConnection(): Promise<void> {
  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();
  await client.query('SELECT 1');
  await client.end();
}

async function main() {
  await verifyDbConnection();
  console.log('✅ Database connected');

  const { httpServer } = await createApp();

  httpServer.listen(env.port, () => {
    console.log(`✅ Server running on port ${env.port}`);
    console.log(
      `📡 GraphQL endpoint: http://localhost:${env.port}/graphql`,
    );
  });
}

main().catch((err) => {
  console.error('❌ Server failed to start:', err);
  process.exit(1);
});
