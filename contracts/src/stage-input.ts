import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Digest, Id } from './scalars.ts'
import {
  inputV6Scopes,
  inputV6Shared,
  ProcessingInputV2,
  type ProcessingInputV6Dto,
} from './processing.ts'
import { SealedBrief } from './brief.ts'
import { SealedMatch } from './match-outcome.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

/** The tool profile a `/7` input seals: the session tools plus its stage's tools. */
export const STAGE_TOOL_PROFILE = 'native-session-stage-tools/1'

const inputV7Shared = {
  ...inputV6Shared,
  schema_version: Type.Literal('bench-intake-input/7'),
  profile_id: Type.Literal('synthetic-session/1'),
  instruction_version: Type.Literal('synthetic-session/1'),
  tool_profile_version: Type.Literal(STAGE_TOOL_PROFILE),
  agent: Type.Null(),
  settings_revision: Type.Null(),
  /** The digest of the stage's instruction pack, which follows the profile's instructions. */
  stage_instructions_sha256: Digest,
  brief: SealedBrief,
}

/**
 * A stage session's opening manifest: the `/6` fields, its stage pack's digest and the brief it
 * starts from: the batch's Examine lead's, or a lot's. Until a profile seals it by configuration,
 * only `synthetic-session/1` under the test-only fixture switch writes it.
 */
export const ProcessingInputV7 = Type.Union([
  object({ ...inputV7Shared, ...inputV6Scopes[0] }),
  object({
    ...inputV7Shared,
    // A `/7` lot is served by Research or Images; no Inventory session is queued for it.
    stage: Type.Union([Type.Literal('research'), Type.Literal('images')]),
    subject_id: Id,
    subject: ProcessingInputV2.properties.subject,
    linked_part: ProcessingInputV2.properties.linked_part,
    /** The Match outcome the lot was queued under and the stage's mode. */
    match: SealedMatch,
  }),
])

export const stageInputSchemas = { ProcessingInputV7 }

export type ProcessingInputV7Dto = Static<typeof ProcessingInputV7>
/** Every session input a session handler decodes; validated by the version it names. */
export type SessionInputDto = ProcessingInputV6Dto | ProcessingInputV7Dto
