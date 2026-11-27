import type {
  MatchCandidateDto,
  MatchContributionHitDto,
  MatchKeyDto,
  MatchLotDto,
  MatchMissingDto,
  MatchOutcomeDto,
  MatchPartCandidateDto,
  MatchQuestionDto,
} from '@invimport/contracts'
import type { PillTone } from '#/components/ui'

/** A key as the Match table and question show it: the code in mono, then who makes or sells it. */
type KeyWords = { code: string; by?: string }

export function keyWords(key: MatchKeyDto): KeyWords {
  switch (key.kind) {
    case 'mpn':
      return { code: key.mpn, by: key.manufacturer }
    case 'type':
      return { code: key.type, by: key.manufacturer }
    case 'nsn':
      return { code: `NSN ${key.nsn}` }
    case 'ipn':
      return { code: `IPN ${key.ipn}` }
    case 'sku':
      return { code: `SKU ${key.sku}`, by: key.supplier }
    case 'batch_code':
      return { code: `batch ${key.batch_code}` }
  }
}

/** A key on one line, for an accessible name or a plain list. */
export function keyText(key: MatchKeyDto) {
  const { code, by } = keyWords(key)

  return by ? `${code} + ${by}` : code
}

/** A Part candidate by its IPN, else its name, as InvenTree lists it. */
export function partName(candidate: MatchPartCandidateDto) {
  return candidate.part.ipn ?? candidate.part.name
}

export function partCandidates(candidates: readonly MatchCandidateDto[]) {
  return candidates.filter(
    (candidate): candidate is MatchPartCandidateDto => candidate.kind === 'part',
  )
}

/** The Part a decision targets, by the IPN its candidate carried when the question showed it. */
function targetName(lot: MatchLotDto) {
  if (!lot.target) {
    return undefined
  }
  const pk = lot.target.part_pk
  const candidate = partCandidates(lot.candidates).find((item) => item.part.pk === pk)

  return candidate ? partName(candidate) : lot.target.name
}

type MatchResult = { text: string; tone: PillTone; glyph: string }

/** What a lot's open question asks about, as its Result pill says it. */
function questionResult(lot: MatchLotDto, question: MatchQuestionDto | undefined): MatchResult {
  const kind = question?.kind ?? (lot.contribution ? 'contribution' : 'candidates')
  if (kind === 'contribution') {
    return { text: 'Already imported?', tone: 'bad', glyph: '!' }
  }
  if (kind === 'unresolved') {
    return { text: 'Not identified', tone: 'warn', glyph: '?' }
  }
  if (kind === 'target_lost') {
    return { text: 'Its Part no longer matches', tone: 'warn', glyph: '!' }
  }
  const candidates = question?.candidates ?? lot.candidates
  const [part] = partCandidates(candidates)
  if (!part) {
    return { text: 'Possible: another batch', tone: 'warn', glyph: '?' }
  }
  if (part.verdict === 'exact') {
    return { text: `Exact: ${partName(part)}`, tone: 'warn', glyph: '?' }
  }
  if (part.verdict === 'duplicate') {
    return { text: `Already in stock? ${partName(part)}`, tone: 'bad', glyph: '!' }
  }
  return { text: `Possible: ${partName(part)}`, tone: 'warn', glyph: '?' }
}

/** A decided or clear lot's result: what it becomes. */
function outcomeResult(lot: MatchLotDto, outcome: MatchOutcomeDto): MatchResult {
  if (outcome.basis.kind === 'clear') {
    return { text: 'No match: new Part', tone: 'info', glyph: '＋' }
  }
  const target = targetName(lot) ?? 'an existing Part'
  switch (outcome.basis.decision) {
    case 'add_stock':
      return { text: `Add stock to ${target}`, tone: 'ok', glyph: '✓' }
    case 'fill_gaps':
      return { text: `Fill what’s missing: ${target}`, tone: 'ok', glyph: '✓' }
    case 'new_part':
      return { text: 'New Part', tone: 'info', glyph: '＋' }
    case 'already_imported':
      return { text: 'Already imported', tone: 'neutral', glyph: '–' }
  }
}

/** A lot's Result pill: the search's state, its open question or what it was decided as. */
export function lotResult(lot: MatchLotDto, question: MatchQuestionDto | undefined): MatchResult {
  switch (lot.state) {
    case 'searching':
      return { text: 'Searching…', tone: 'outline', glyph: '…' }
    case 'unavailable':
      return { text: 'Couldn’t search', tone: 'bad', glyph: '!' }
    case 'held':
      return { text: 'Held', tone: 'outline', glyph: '⏸' }
    case 'question':
      return questionResult(lot, question)
    case 'clear':
    case 'decided':
      return lot.outcome
        ? outcomeResult(lot, lot.outcome)
        : { text: 'No match: new Part', tone: 'info', glyph: '＋' }
  }
}

function researchWords(research: MatchOutcomeDto['research']) {
  switch (research.mode) {
    case 'full':
      return 'Research in full'
    case 'skipped':
      return 'Research skipped'
    case 'gaps': {
      const fields = research.fields.map((field) =>
        field === 'datasheet' ? 'datasheet' : 'parameters',
      )
      return `Research: ${fields.join(' and ')} only`
    }
  }
}

function imagesWords(images: MatchOutcomeDto['images']) {
  switch (images.mode) {
    case 'full':
      return 'Images in full'
    case 'skipped':
      return 'Images skipped'
    case 'stock':
      return images.part_image ? 'stock photo and Part image' : 'stock photo'
  }
}

/** What an outcome runs: "Research and Images in full", "Research skipped · stock photo". */
function outcomeRuns(outcome: MatchOutcomeDto) {
  if (outcome.basis.kind === 'decision' && outcome.basis.decision === 'already_imported') {
    return 'Nothing runs: the lot is left out'
  }
  if (outcome.research.mode === 'full' && outcome.images.mode === 'full') {
    return 'Research and Images in full'
  }

  return `${researchWords(outcome.research)} · ${imagesWords(outcome.images)}`
}

function waitWords(waits: MatchLotDto['waits']) {
  if (waits.length === 2) {
    return 'Research and Images wait'
  }

  return waits[0] === 'research' ? 'Research waits' : 'Images waits'
}

/**
 * What runs for the lot, from its state, the stages Match holds and its outcome's modes. An
 * already-imported question and a held lot run nothing.
 */
export function lotRuns(lot: MatchLotDto, question: MatchQuestionDto | undefined) {
  if (lot.state === 'unavailable') {
    return 'Couldn’t search InvenTree; nothing starts until it can'
  }
  if (lot.state === 'held') {
    return 'Nothing runs while it is held'
  }
  const contribution =
    (question?.kind ?? (lot.contribution ? 'contribution' : '')) === 'contribution'
  if (lot.state === 'question' && contribution) {
    return 'Nothing runs until you answer'
  }
  if (lot.waits.length > 0) {
    const reason = lot.state === 'question' ? ' for you' : ' for the search'

    return `${waitWords(lot.waits)}${reason}`
  }
  if (lot.outcome) {
    return outcomeRuns(lot.outcome)
  }

  return lot.state === 'searching' ? 'Waits for the search' : ''
}

/** The lot's counts in the summary pills above the table. */
export function matchSummary(lots: readonly MatchLotDto[]) {
  let needYou = 0
  let existing = 0
  let fresh = 0
  let searching = 0
  let unavailable = 0
  for (const lot of lots) {
    const basis = lot.outcome?.basis
    if (lot.state === 'question') {
      needYou += 1
    } else if (lot.state === 'searching') {
      searching += 1
    } else if (lot.state === 'unavailable') {
      unavailable += 1
    } else if (
      basis?.kind === 'clear' ||
      (basis?.kind === 'decision' && basis.decision === 'new_part')
    ) {
      fresh += 1
    } else if (
      basis?.kind === 'decision' &&
      (basis.decision === 'add_stock' || basis.decision === 'fill_gaps')
    ) {
      existing += 1
    }
  }

  return { needYou, existing, fresh, searching, unavailable }
}

/** What an existing Part lacks, with the key parameters counted: "missing 2 parameters". */
export function missingWords(missing: readonly MatchMissingDto[]) {
  const parameters = missing.filter((item) => item.kind === 'parameter').length
  const named = missing.flatMap((item) => {
    switch (item.kind) {
      case 'datasheet':
        return ['missing datasheet']
      case 'part_image':
        return ['missing image']
      case 'manufacturer_part':
        return ['missing manufacturer Part']
      case 'supplier_part':
        return ['missing supplier Part']
      case 'parameter':
        return []
    }
  })
  if (parameters > 0) {
    named.push(parameters === 1 ? 'missing 1 parameter' : `missing ${parameters} parameters`)
  }

  return named
}

/** What InvenTree already has of the fields Match checks, shown before what it lacks. */
export function presentWords(candidate: MatchPartCandidateDto) {
  const lacks = new Set(candidate.missing.map((item) => item.kind))
  const has: string[] = []
  if (candidate.part.has_image && !lacks.has('part_image')) {
    has.push('image')
  }
  if (!lacks.has('manufacturer_part')) {
    has.push('manufacturer Part')
  }
  if (!lacks.has('datasheet')) {
    has.push('datasheet')
  }

  return has
}

const STOCK_WORDS: Record<Extract<MatchContributionHitDto, { readable: true }>['stock'], string> = {
  created: 'Its stock was created.',
  not_created: 'Its stock was never created.',
  uncertain: 'Whether its stock was created is uncertain.',
  deleted: 'Its stock was later deleted.',
  unavailable: 'Its stock couldn’t be read.',
}

/** An original-contribution hit in words; the run and its stock only when the operator may read it. */
export function contributionWords(hit: MatchContributionHitDto) {
  if (!hit.readable) {
    return 'This lot’s contribution was already approved.'
  }

  return `An earlier import round already approved this lot’s contribution. ${STOCK_WORDS[hit.stock]}`
}

/** Where the identity Match searched with came from. */
export function identitySource(lot: MatchLotDto | undefined) {
  if (!lot) {
    return undefined
  }

  return lot.identity.kind === 'examine'
    ? 'from Examine’s reading'
    : 'from the identifiers you confirmed'
}
