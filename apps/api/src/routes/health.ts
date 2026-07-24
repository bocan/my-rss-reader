import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: process is up.
  app.get('/healthz', async () => ({ status: 'ok' }));

  // Readiness: dependencies (the database) are reachable.
  app.get('/readyz', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable', db: false });
    }
  });
}
