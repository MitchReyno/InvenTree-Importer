import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import {
  NodeStreamableHTTPServerTransport,
  localhostHostValidation,
} from '@modelcontextprotocol/node'
import { schemas } from '@invimport/contracts'
import type { ProcessingConfig } from '../../processing/attempts.ts'
import type { BlobStore } from '../../media/blob-store.ts'
import { resolveSessionCapability } from './capability.ts'
import { sessionTools, type SessionToolOutput } from './handlers.ts'

const DEFAULT_STATUS_INTERVAL_MS = 2000

const TOOLS = {
  read_batch: {
    schema: 'SessionReadBatchArgs',
    description:
      'Examine lead session only. Read the batch revision to pass as base_revision, with its lots, Parts and observations, including operator edits and suggestions.',
  },
  record_observation: {
    schema: 'RecordObservationArgs',
    description:
      'Examine lead session only. Record an item seen in a region of one evidence version, or revise one of your observations. Pass the batch revision you last read.',
  },
  propose_lot: {
    schema: 'ProposeLotArgs',
    description:
      'Examine lead session only. Form a draft lot from observations of the same physical thing, or extend one of your lots. Quantities are estimates with a basis; never add up the same items twice.',
  },
  regroup: {
    schema: 'RegroupArgs',
    description:
      'Examine lead session only. Move observations between your lots. Operator-edited lots and observations only receive suggestions.',
  },
  status: {
    schema: 'SessionStatusArgs',
    description: 'Report the step you are on: one line of at most 120 characters.',
  },
  propose: {
    schema: 'SessionProposeArgs',
    description:
      'Publish a proposal for this lot, citing only delivered evidence and notes. Correct any returned field issues before retrying.',
  },
  ask: {
    schema: 'SessionAskArgs',
    description:
      'Ask the operator a question. Name the fields it affects and the assumption you continue with; keep working.',
  },
  reply: {
    schema: 'SessionReplyArgs',
    description: 'Reply to an operator chat message from the inbox.',
  },
  fetch_evidence: {
    schema: 'SessionFetchEvidenceArgs',
    description:
      'Fetch a delivered evidence image within the per-run image budget. Successful byte delivery includes source: copy that complete reference unchanged into citations.',
  },
  read_inbox: {
    schema: 'SessionReadInboxArgs',
    description:
      'Read pending inbox items after a sequence. Passing a sequence acknowledges every item up to it.',
  },
} as const satisfies Record<string, { schema: keyof typeof schemas; description: string }>

const LEAD_ONLY = new Set(['read_batch', 'record_observation', 'propose_lot', 'regroup'])

/**
 * Agents see the contract's own JSON Schema. Validation stays with the handler, so an invalid
 * call gets a typed result the agent can correct rather than a protocol error.
 */
function contractSchema(name: keyof typeof schemas): StandardSchemaWithJSON {
  const jsonSchema = () => schemas[name] as unknown as Record<string, unknown>

  return {
    '~standard': {
      version: 1,
      vendor: 'bench-intake',
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: jsonSchema, output: jsonSchema },
    },
  }
}

function toolResult(output: SessionToolOutput) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(output.result) },
      ...(output.images ?? []).map((image) => ({
        type: 'image' as const,
        data: image.base64,
        mimeType: image.mediaType,
      })),
    ],
    structuredContent: output.result as unknown as Record<string, unknown>,
    isError: !output.result.ok,
  }
}

export interface SessionToolServerOptions {
  pool: Pool
  writerPool?: Pool
  cropCacheDir?: string
  config: ProcessingConfig
  store?: BlobStore
  statusIntervalMs?: number
}

/** The worker's loopback MCP endpoint. The web process never hosts it. */
export async function startSessionToolServer(options: SessionToolServerOptions) {
  const tools = sessionTools({
    pool: options.pool,
    writerPool: options.writerPool,
    cropCacheDir: options.cropCacheDir,
    config: options.config,
    store: options.store,
    statusIntervalMs: options.statusIntervalMs ?? DEFAULT_STATUS_INTERVAL_MS,
    imageBudget: new Map(),
    deliveredMedia: new Map(),
  })
  const hostGuard = localhostHostValidation()
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 })

  const handle = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.hijack()
    const req = request.raw
    const res = reply.raw
    if (!hostGuard(req, res)) {
      return
    }
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]
    const principal = token ? await resolveSessionCapability(options.pool, token) : undefined
    if (!token || !principal) {
      res
        .writeHead(401, { 'content-type': 'application/json' })
        .end('{"error":"capability_refused"}')
      return
    }
    const server = new McpServer({ name: 'intake', version: '1' })
    // Lot-forming tools exist only for the batch's Examine lead session; handlers check again.
    const lead = (principal.stage as string) === 'examine'
    for (const [name, tool] of Object.entries(TOOLS)) {
      if (!lead && LEAD_ONLY.has(name)) {
        continue
      }
      server.registerTool(
        name,
        { description: tool.description, inputSchema: contractSchema(tool.schema) },
        async (args: unknown) => {
          try {
            return toolResult(await tools[name as keyof typeof TOOLS](token, args))
          } catch (error) {
            // The call's transaction rolled back; answer instead of leaving the agent waiting.
            // Only the tool name and a safe code are logged; arguments may hold evidence text.
            process.stderr.write(
              JSON.stringify({
                event: 'session_tool_failed',
                tool: name,
                code:
                  error instanceof Error && /^[a-z_]{1,64}$/.test(error.message)
                    ? error.message
                    : 'unexpected',
              }) + '\n',
            )
            return toolResult({
              result: {
                ok: false,
                error: 'tool_failed',
                message: 'The tool failed unexpectedly and changed nothing. Try again later.',
                pending_inbox: 0,
              },
            })
          }
        },
      )
    }
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, request.body)
  }

  app.post('/mcp', handle)
  app.get('/mcp', handle)
  app.delete('/mcp', handle)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') {
    throw new Error('session_tool_server_unbound')
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => app.close(),
  }
}
