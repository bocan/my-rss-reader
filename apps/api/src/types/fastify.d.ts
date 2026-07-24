import type { PublicUser } from '@rss/shared';
import type { preHandlerHookHandler } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated user, or null for anonymous requests. */
    user: PublicUser | null;
  }
  interface FastifyInstance {
    /** preHandler that rejects unauthenticated requests with 401. */
    requireAuth: preHandlerHookHandler;
  }
}
