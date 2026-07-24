import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveSession, SESSION_COOKIE } from '../lib/session.js';

/**
 * Wires session handling onto the Fastify instance at the root scope so every
 * child route inherits it:
 *   - `request.user` is populated on each request (null when unauthenticated).
 *   - `app.requireAuth` is a preHandler that 401s anonymous requests.
 */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const token = request.cookies[SESSION_COOKIE];
    request.user = await resolveSession(token);
  });

  app.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
    }
  });
}
