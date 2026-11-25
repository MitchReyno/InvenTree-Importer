import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Digest, Id, Revision } from './scalars.ts'
import { AgentSelection } from './agent-selection.ts'
import {
  inputV6Scopes,
  inputV6Shared,
  ProcessingInputV2,
  type ProcessingInputV6Dto,
} from './processing.ts'
import { SealedBrief } from './brief.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

/** The tool profile a `/7` input seals: the session tools plus its stage's tools. */
export const STAGE_TOOL_PROFILE = 'native-session-stage-tools/1'

const inputV7Scopes = [
  inputV6Scopes[0],
  {
    // A `/7` lot is served by Research or Images; no Inventory session is queued for it.
    stage: Type.Union([Type.Literal('research'), Type.Literal('images')]),
    subject_id: Id,
    subject: ProcessingInputV2.properties.subject,
    linked_part: ProcessingInputV2.properties.linked_part,
  },
]
/**
 * The profiles that seal `/7`: the synthetic fixture, and the stage profile `shared-vm-agent/4`
 * with its provider selection. Until a profile seals it by configuration, only tests under the
 * test-only fixture switch write it.
 */
const inputV7Profiles = [
  {
    profile_id: Type.Literal('synthetic-session/1'),
    instruction_version: Type.Literal('synthetic-session/1'),
    agent: Type.Null(),
    settings_revision: Type.Null(),
  },
  {
    profile_id: Type.Literal('shared-vm-agent/4'),
    instruction_version: Type.Literal('shared-vm-agent/4'),
    agent: AgentSelection,
    settings_revision: Revision,
  },
]
/**
 * A stage session's opening manifest: the `/6` fields, its stage pack's digest and the brief it
 * starts from.
 */
export const ProcessingInputV7 = Type.Union(
  inputV7Profiles.flatMap((profile) =>
    inputV7Scopes.map((scope) =>
      object({
        ...inputV6Shared,
        schema_version: Type.Literal('bench-intake-input/7'),
        ...profile,
        tool_profile_version: Type.Literal(STAGE_TOOL_PROFILE),
        /** The digest of the stage's instruction pack, which follows the profile's instructions. */
        stage_instructions_sha256: Digest,
        brief: SealedBrief,
        ...scope,
      }),
    ),
  ),
)

export const stageInputSchemas = { ProcessingInputV7 }

export type ProcessingInputV7Dto = Static<typeof ProcessingInputV7>
/** Every session input a session handler decodes; validated by the version it names. */
export type SessionInputDto = ProcessingInputV6Dto | ProcessingInputV7Dto
