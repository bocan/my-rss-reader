import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError, z } from 'zod';
import { env, isProd, isTest } from './env.js';
import { registerAuth } from './plugins/auth.js';
import { registerRoutes } from './routes/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveWebDist(): string | null {
  const candidates = [
    process.env.WEB_DIST,
    resolve(__dirname, '../../web/dist'), // monorepo layout
    resolve(__dirname, '../web'), // container layout (see Dockerfile)
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(join(p, 'index.html'))) ?? null;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isTest
      ? false
      : {
          level: isProd ? 'info' : 'debug',
          transport: isProd
            ? undefined
            : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
        },
    trustProxy: true,
  });

  await app.register(helmet, {
    // The SPA is served from the same origin; tune CSP when hardening for prod.
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: env.APP_ORIGIN,
    credentials: true,
  });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  registerAuth(app);

  // Uniform error shape. Zod validation failures become 400s.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: z.prettifyError(error),
        statusCode: 400,
      });
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) request.log.error(error);
    return reply.code(statusCode).send({
      error: error.name || 'InternalServerError',
      message: statusCode >= 500 ? 'Internal server error' : error.message,
      statusCode,
    });
  });

  await app.register(registerRoutes, { prefix: '/api' });

  // In production the built SPA is served from the same origin; client-side
  // routes fall back to index.html. API misses always get a structured 404.
  const webDist = resolveWebDist();
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist });
    app.log.info(`Serving web client from ${webDist}`);
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith('/api') || !webDist) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'Route not found', statusCode: 404 });
    }
    return reply.sendFile('index.html');
  });

  return app;
}
