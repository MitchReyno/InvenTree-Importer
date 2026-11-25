import { evidenceFormatHeader } from '#/agents/shared-vm/evidence-release.ts'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { recordMediaDelivery, type DeliveredMedia, type DeliveredPage } from './handlers.ts'
import { McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import {
  NodeStreamableHTTPServerTransport,
  localhostHostValidation,
} from '@modelcontextprotocol/node'
import { schemas } from '@invimport/contracts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import type { BlobStore } from '#/media/blob-store.ts'
import { resolveSessionCapability, type SessionPrincipal } from './capability.ts'
import { sessionTools, type SessionToolOutput } from './handlers.ts'
import { ASK_GUIDANCE } from './ask-guidance.ts'

const DEFAULT_STATUS_INTERVAL_MS = 2000

const TOOLS = {
  read_batch: {
    schema: 'SessionReadBatchArgs',
    description:
      'Examine lead session only. Read the batch revision to pass as base_revision, with its lots, Parts and observations, including operator edits and suggestions.',
  },
  read_lot: {
    schema: 'SessionReadLotArgs',
    description:
      'Read the brief of a lot this session serves, one page at a time. Pass page_token to continue a sequence, revision for the brief you started from, or neither for the current brief and its revision. A page whose newer is set comes from an older brief.',
  },
  read_guide: {
    schema: 'SessionReadGuideArgs',
    description:
      'Read your stage’s guide: long reference material behind your instructions. Call it with no section to list the sections and their titles, or name a section to read it. Every session of the profile reads the same text.',
  },
  read_vocabulary: {
    schema: 'SessionReadVocabularyArgs',
    description:
      'Research sessions only. Look up the catalogue records this batch has observed (categories, parameter templates, category mappings and companies), each with the reference a proposal cites. Filter by kind, or by a search matched against labels regardless of case. Results come 50 to a page; for the next, pass the returned next_page_token as page_token, with the same kind and search.',
  },
  record_observation: {
    schema: 'RecordObservationArgs',
    description:
      'Examine lead session only. Record an item seen in a region of one evidence version, or revise one of your observations. Pass the batch revision you last read.',
  },
  propose_lot: {
    schema: 'ProposeLotArgs',
    description:
      'Examine lead session only. Form a draft lot from observations of the same physical thing, or extend one of your lots. Quantities are estimates with a basis; never add up the same items twice. When it looks like another lot, say in separation_reason why it is kept apart.',
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
      'Publish a proposal for this lot, citing only delivered evidence and notes. To cite a web page you read with WebFetch, use schema_version bench-intake-proposal/6 and add {"kind":"web_page","url":...} to its top-level sources, with the page title and read_at time if you have them; the URL must be absolute http or https with no credentials. A web page is shown as agent-reported, never as verified evidence, and cannot appear in relies_on or catalogue sources. Correct any returned field issues before retrying.',
  },
  ask: {
    schema: 'SessionAskArgsV2',
    description: `${ASK_GUIDANCE} Name the fields it affects, use a number step only for a lot's quantity, and keep working.`,
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

/** A `/7` lead's read_batch pages its brief, so it has its own arguments. */
const STAGE_READ_BATCH = {
  schema: 'SessionReadBriefBatchArgs',
  description:
    'Examine lead session only. Read your brief one page at a time: the batch with its lots, Parts and observations with full readings, including operator edits and suggestions. Pass page_token to continue a sequence, revision for the brief you started from, or neither for the current brief. The returned revision is the brief’s; pass it as base_revision, and read the current brief again before writing when a page’s newer is set.',
} as const satisfies { schema: keyof typeof schemas; description: string }

const LEAD_ONLY = new Set(['read_batch', 'record_observation', 'propose_lot', 'regroup'])
/** Tools only a `/7` Research or Images session has. */
const STAGE_LOT_ONLY = new Set(['read_lot'])
/** Tools every `/7` session has, and only `/7` sessions. */
const STAGE_ONLY = new Set(['read_guide'])
/** Tools only a `/7` Research session has. */
const STAGE_RESEARCH_ONLY = new Set(['read_vocabulary'])

/** Whether a principal is offered a tool: its sealed input and stage decide. */
function offered(name: string, principal: SessionPrincipal) {
  const lead = (principal.stage as string) === 'examine'
  const stageInput = principal.manifest.schema_version === 'bench-intake-input/7'
  if (LEAD_ONLY.has(name)) {
    return lead
  }
  if (STAGE_LOT_ONLY.has(name)) {
    return !lead && stageInput
  }
  if (STAGE_ONLY.has(name)) {
    return stageInput
  }
  if (STAGE_RESEARCH_ONLY.has(name)) {
    return stageInput && principal.manifest.stage === 'research'
  }
  return true
}

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
  evidenceImage?: 'original' | 'preview'
  statusIntervalMs?: number
}

/** The worker's loopback MCP endpoint. The web process never hosts it. */
export async function startSessionToolServer(options: SessionToolServerOptions) {
  const deliveredMedia: DeliveredMedia = new Map()
  const tools = sessionTools({
    pool: options.pool,
    writerPool: options.writerPool,
    cropCacheDir: options.cropCacheDir,
    config: options.config,
    store: options.store,
    evidenceImage: options.evidenceImage,
    statusIntervalMs: options.statusIntervalMs ?? DEFAULT_STATUS_INTERVAL_MS,
    imageBudget: new Map(),
    deliveredMedia,
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
    res.setHeader(evidenceFormatHeader, 'current')
    const server = new McpServer({ name: 'intake', version: '1' })
    // Lot-forming tools exist only for the batch's Examine lead session, and the brief, guide and
    // vocabulary reads only for stage sessions; handlers check again.
    for (const [name, tool] of Object.entries(TOOLS)) {
      if (!offered(name, principal)) {
        continue
      }
      const definition =
        name === 'read_batch' && principal.manifest.schema_version === 'bench-intake-input/7'
          ? STAGE_READ_BATCH
          : tool
      server.registerTool(
        name,
        { description: definition.description, inputSchema: contractSchema(definition.schema) },
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
    confirmEvidence: (job: string, version: string, delivered?: DeliveredPage) =>
      recordMediaDelivery(deliveredMedia, job, version, delivered),
    close: () => app.close(),
  }
}
