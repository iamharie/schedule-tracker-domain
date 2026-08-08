import express, { Application } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'http';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { typeDefs } from './graphql/typeDefs';
import { resolvers } from './graphql/resolvers';
import { env } from './config/env';
import type { AppContext } from './graphql/context';

export async function createApp(): Promise<{
  app: Application;
  httpServer: http.Server;
}> {
  const app = express();
  const httpServer = http.createServer(app);

  const server = new ApolloServer<AppContext>({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
  });

  await server.start();

  app.use(
    '/graphql',
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
    express.json(),
    cookieParser(),
    expressMiddleware(server, {
      context: async ({ req, res }): Promise<AppContext> => ({ req, res }),
    }),
  );

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'OK', service: 'schedule-tracker-domain' });
  });

  return { app, httpServer };
}
