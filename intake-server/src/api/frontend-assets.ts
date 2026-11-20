import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { servesOutside } from '#/inventory/credential-store.ts'

/**
 * Serves the built browser app. Each request's file is checked after following links, so no
 * link placed among the published files can reach the saved read token.
 */
export async function registerFrontendAssets(
  server: FastifyInstance,
  root: string,
  secretsDir: string | undefined,
) {
  const outsideSecrets = await servesOutside(secretsDir)
  await server.register(fastifyStatic, {
    root,
    index: 'index.html',
    dotfiles: 'deny',
    allowedPath: (pathName, served) =>
      outsideSecrets(join(typeof served === 'string' ? served : root, pathName)),
  })
}
