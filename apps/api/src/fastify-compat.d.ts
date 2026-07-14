import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Fastify 5.8+ intentionally types errors as unknown. The application error
 * handler accepts Error instances with an optional HTTP status code, which is
 * the shape produced by Fastify and the domain errors in this API.
 */
declare module 'fastify' {
  interface FastifyInstance {
    setErrorHandler(
      handler: (
        error: Error & { statusCode?: number },
        request: FastifyRequest,
        reply: FastifyReply
      ) => unknown
    ): this;
  }
}

export {};
