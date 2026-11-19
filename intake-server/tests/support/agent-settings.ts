import {
  AGENT_MODEL_SUGGESTIONS,
  type AgentSelectionDto,
  type AgentSettingsUpdateDto,
} from '@invimport/contracts'

/**
 * A whole settings update with one provider on as the default and every step on Default, for
 * tests that only care which provider and model sessions use.
 */
export function singleProvider({
  expected_revision,
  selection,
  session_concurrency = 3,
  ...rest
}: {
  expected_revision: string
  selection: AgentSelectionDto
  session_concurrency?: number
} & Partial<
  Pick<
    AgentSettingsUpdateDto,
    'part_description_style' | 'new_batch_instructions' | 'auto_tags_default' | 'stage_selections'
  >
>): AgentSettingsUpdateDto {
  const other = selection.provider === 'claude' ? 'codex' : 'claude'
  return {
    expected_revision,
    providers: {
      [selection.provider]: {
        enabled: true,
        authentication: selection.authentication,
        default_model: selection.model,
      },
      [other]: {
        enabled: false,
        authentication: 'subscription',
        default_model: AGENT_MODEL_SUGGESTIONS[other][0],
      },
    } as AgentSettingsUpdateDto['providers'],
    default_provider: selection.provider,
    stage_selections: {},
    session_concurrency,
    new_batch_instructions: '',
    part_description_style: '',
    auto_tags_default: false,
    ...rest,
  }
}
