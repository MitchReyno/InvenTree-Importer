import type {
  MatchCandidateDto,
  MatchContributionHitDto,
  MatchDecisionDto,
  MatchKeyDto,
  MatchPartCandidateDto,
  MatchQuestionKindDto,
  MatchQuestionNoteDto,
  QuestionStepDto,
} from '@invimport/contracts'

/** The question's one step; its options name what each answer does. */
export const MATCH_STEP_ID = 'decision'
/** Choice steps offer at most six options, so at most two Part candidates get their own. */
const OPTION_PARTS = 2

/** The content a match question carries, before it is stored with its pins. */
export interface MatchQuestionContent {
  kind: MatchQuestionKindDto
  title: string
  reason: string
  steps: QuestionStepDto[]
  keys: MatchKeyDto[]
  candidates: MatchCandidateDto[]
  notes: MatchQuestionNoteDto[]
  contribution?: MatchContributionHitDto
}

/** What an option does: a decision on a Part, or a choice that records none. */
export type MatchOptionEffect =
  { kind: 'decision'; decision: MatchDecisionDto; partPk?: string } | { kind: 'held' }

const FILLABLE = new Set(['datasheet', 'parameter', 'part_image'])

/** Whether InvenTree lacks something fill what's missing can fill on this Part. */
export function fillable(candidate: MatchPartCandidateDto) {
  return candidate.missing.some((missing) => FILLABLE.has(missing.kind))
}

function partCandidates(candidates: readonly MatchCandidateDto[]) {
  return candidates.filter(
    (candidate): candidate is MatchPartCandidateDto => candidate.kind === 'part',
  )
}

/** A short line naming what InvenTree lacks for the Part, or that it lacks nothing listed. */
function missingText(candidate: MatchPartCandidateDto) {
  const parameters = candidate.missing.filter((missing) => missing.kind === 'parameter').length
  const named = candidate.missing.flatMap((missing) => {
    switch (missing.kind) {
      case 'datasheet':
        return ['a datasheet']
      case 'part_image':
        return ['a Part image']
      case 'manufacturer_part':
        return ['a manufacturer Part']
      case 'supplier_part':
        return ['a supplier Part for this supplier']
      case 'parameter':
        return []
    }
  })
  if (parameters) {
    named.push(parameters === 1 ? '1 key parameter' : `${parameters} key parameters`)
  }
  return named.length ? `InvenTree is missing ${named.join(', ')}.` : ''
}

function partName(candidate: MatchPartCandidateDto) {
  return candidate.part.ipn ? `${candidate.part.ipn} · ${candidate.part.name}` : candidate.part.name
}

/** The options a candidates question offers, each with what it does. */
export function candidateOptions(candidates: readonly MatchCandidateDto[]) {
  const options: { id: string; label: string; detail?: string; effect: MatchOptionEffect }[] = []
  partCandidates(candidates)
    .slice(0, OPTION_PARTS)
    .forEach((candidate, index) => {
      const name = candidate.part.ipn ?? candidate.part.name
      options.push({
        id: `add_stock_${index + 1}`,
        label: `Add stock to ${name}`.slice(0, 80),
        detail: 'No research · a stock photo',
        effect: { kind: 'decision', decision: 'add_stock', partPk: candidate.part.pk },
      })
      if (fillable(candidate)) {
        options.push({
          id: `fill_gaps_${index + 1}`,
          label: `Add stock to ${name}, and fill what's missing`.slice(0, 80),
          detail: 'Research only what InvenTree lacks · a stock photo',
          effect: { kind: 'decision', decision: 'fill_gaps', partPk: candidate.part.pk },
        })
      }
    })
  options.push(
    {
      id: 'new_part',
      label: "It's a new Part",
      detail: 'Full research and photos',
      effect: { kind: 'decision', decision: 'new_part' },
    },
    {
      id: 'already_imported',
      label: 'Already imported',
      detail: 'Leave this lot out',
      effect: { kind: 'decision', decision: 'already_imported' },
    },
  )
  return options
}

/** The options of each question kind; only a candidates question offers add stock. */
export function questionOptions(
  kind: MatchQuestionKindDto,
  candidates: readonly MatchCandidateDto[],
) {
  if (kind === 'candidates') {
    return candidateOptions(candidates)
  }
  if (kind === 'contribution') {
    return [
      {
        id: 'already_imported',
        label: 'Already imported',
        detail: 'Leave this lot out',
        effect: { kind: 'decision', decision: 'already_imported' } as MatchOptionEffect,
      },
      {
        id: 'keep_held',
        label: 'Keep it held for now',
        detail: 'Nothing runs while you look at the earlier import',
        effect: { kind: 'held' } as MatchOptionEffect,
      },
    ]
  }
  return [
    {
      id: 'new_part',
      label: "It's a new Part",
      detail: 'Full research and photos on what is known',
      effect: { kind: 'decision', decision: 'new_part' } as MatchOptionEffect,
    },
    {
      id: 'already_imported',
      label: 'Already imported',
      detail: 'Leave this lot out',
      effect: { kind: 'decision', decision: 'already_imported' } as MatchOptionEffect,
    },
  ]
}

function titleOf(
  kind: MatchQuestionKindDto,
  candidates: readonly MatchCandidateDto[],
  lotLabel: string,
) {
  const parts = partCandidates(candidates)
  switch (kind) {
    case 'contribution':
      return 'This lot looks already imported'
    case 'unresolved':
      return `What is ${lotLabel}?`.slice(0, 120)
    case 'target_lost':
      return 'The Part this lot was going to add stock to no longer matches'
    case 'candidates':
      if (parts.length === 1) {
        const verb = parts[0].verdict === 'exact' ? 'looks like' : 'may be'
        return `This ${verb} existing Part ${parts[0].part.ipn ?? parts[0].part.name}`.slice(0, 120)
      }
      if (parts.length > 1) {
        return `This may be one of ${parts.length} existing Parts`
      }
      return 'Another batch has a lot like this one'
  }
}

function reasonOf(
  kind: MatchQuestionKindDto,
  candidates: readonly MatchCandidateDto[],
  contribution: MatchContributionHitDto | undefined,
) {
  if (kind === 'contribution') {
    return contribution?.readable
      ? 'An earlier import round already approved this lot, so it must not become new stock.'
      : 'This lot was already approved, in a round you cannot open, so it must not become new stock.'
  }
  if (kind === 'unresolved') {
    return 'Match had nothing it could search InvenTree with. Research and Images wait for your answer.'
  }
  if (kind === 'target_lost') {
    return 'Match searched again and found no candidates, so the add stock decision no longer has its Part. Research and Images wait for your answer.'
  }
  const lines = candidates.map((candidate) =>
    candidate.kind === 'part'
      ? [partName(candidate), missingText(candidate)].filter(Boolean).join(' — ')
      : `${candidate.lot_label} in ${candidate.batch_title}, not yet approved`,
  )
  return [
    'Match found these before any research or photos. Research and Images for this lot wait for your answer.',
    ...lines,
  ]
    .join('\n')
    .slice(0, 2048)
}

/** The question for one lot, from what the search found. */
export function matchQuestion(
  kind: MatchQuestionKindDto,
  lotLabel: string,
  found: {
    keys: MatchKeyDto[]
    candidates: MatchCandidateDto[]
    notes: MatchQuestionNoteDto[]
    contribution?: MatchContributionHitDto
  },
): MatchQuestionContent {
  const options = questionOptions(kind, found.candidates)
  return {
    kind,
    title: titleOf(kind, found.candidates, lotLabel),
    reason: reasonOf(kind, found.candidates, found.contribution),
    steps: [
      {
        id: MATCH_STEP_ID,
        prompt: 'What should happen?',
        assumption: 'Research and Images for this lot wait for your answer.',
        answer: {
          kind: 'choice',
          options: options.map(({ id, label, detail }) => ({
            id,
            label,
            ...(detail ? { detail } : {}),
          })),
          other: kind !== 'contribution',
        },
      },
    ],
    keys: found.keys,
    candidates: found.candidates,
    notes: found.notes,
    ...(found.contribution ? { contribution: found.contribution } : {}),
  }
}
