import type { ErrorObject } from 'ajv'
import { Type, type Static } from '@sinclair/typebox'

export const ContractValidationIssue = Type.Object(
  {
    path: Type.String({ maxLength: 256 }),
    rule: Type.String({ minLength: 1, maxLength: 32 }),
    reason: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
)
export type ValidationIssue = Static<typeof ContractValidationIssue>

const MAX_ISSUES = 8
const MAX_ISSUE_BYTES = 2048
const MAX_PATH_CHARACTERS = 256
const reasons: Record<string, string> = {
  required: 'This field is required.',
  additionalProperties: 'An unsupported field is present.',
  type: 'Use the required value type.',
  enum: 'Use one of the allowed choices.',
  const: 'Use the required constant value.',
  pattern: 'Use the required text format.',
  format: 'Use the required value format.',
  minLength: 'The text is too short.',
  maxLength: 'The text is too long.',
  minimum: 'The number is below the allowed minimum.',
  maximum: 'The number exceeds the allowed maximum.',
  minItems: 'More items are required.',
  maxItems: 'Too many items were supplied.',
  uniqueItems: 'Duplicate items are not allowed.',
  anyOf: 'Use one of the supported shapes.',
  oneOf: 'Use exactly one supported shape.',
}

type SchemaNode = Record<string, unknown>

function node(value: unknown): SchemaNode {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as SchemaNode)
    : {}
}

function variants(schema: SchemaNode): SchemaNode[] {
  const alternatives = ['anyOf', 'oneOf', 'allOf'].flatMap((key) =>
    Array.isArray(schema[key]) ? schema[key] : [],
  )
  return [schema, ...alternatives.flatMap((alternative) => variants(node(alternative)))]
}

/** Only schema-owned field names and array indexes may appear in public paths. */
function safePath(schema: unknown, error: ErrorObject): string {
  const tokens = error.instancePath
    .split('/')
    .slice(1)
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    tokens.push(error.params.missingProperty)
  }
  let candidates = variants(node(schema))
  const path: string[] = []
  for (const token of tokens) {
    const next: SchemaNode[] = []
    for (const candidate of candidates) {
      const properties = node(candidate.properties)
      if (Object.hasOwn(properties, token)) {
        next.push(...variants(node(properties[token])))
      } else if (candidate.type === 'array' && /^\d{1,10}$/u.test(token)) {
        next.push(...variants(node(candidate.items)))
      }
    }
    path.push(next.length ? token.replace(/~/g, '~0').replace(/\//g, '~1') : '[field]')
    candidates = next
  }
  const result = path.length ? `/${path.join('/')}` : ''
  return result.length <= MAX_PATH_CHARACTERS ? result : '/[field]'
}

export function copyValidationIssues(
  schema: unknown,
  errors: readonly ErrorObject[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const encoder = new TextEncoder()
  for (const error of errors) {
    const knownRule = Object.hasOwn(reasons, error.keyword)
    const issue = {
      path: safePath(schema, error),
      rule: knownRule ? error.keyword : 'schema',
      reason: reasons[error.keyword] ?? 'This field does not match its schema.',
    }
    if (issues.some((prior) => prior.path === issue.path && prior.rule === issue.rule)) {
      continue
    }
    if (
      issues.length === MAX_ISSUES ||
      encoder.encode(JSON.stringify([...issues, issue])).byteLength > MAX_ISSUE_BYTES
    ) {
      break
    }
    issues.push(issue)
  }
  return issues
}
