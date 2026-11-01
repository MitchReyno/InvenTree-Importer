import { Id, PositivePk, Quantity } from '@invimport/contracts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { sha256, verifyBytes } from '../db/authority.ts'

export const EXECUTOR_BUILD = 'bench-stock/1'
export const CAPABILITY = 'owned-fake-stock/1'
export interface StockOperation {
  operationKey: string
  contributionKey: string
  part: string
  location: string | null
  quantity: string
  barcode: string
}
export interface StockPlan {
  version: 'bench-stock-plan/1'
  deploymentId: string
  targetId: string
  contextId: string
  epoch: string
  build: string
  continuity: string
  capability: typeof CAPABILITY
  sourceId: string
  originalSourceKey: string
  operations: StockOperation[]
}
function record(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys.sort().join(',')
  )
    throw new Error('invalid_stock_plan')
}
export function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !new RegExp(Id.pattern!).test(value))
    throw new Error('invalid_executor_id')
}
export function pk(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !new RegExp(PositivePk.pattern!).test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new Error('invalid_stock_pk')
}
/** v1 freezes the ORIGINAL keys, never a run ID or generated replacement source. */
export function contributionBarcode(originalSourceKey: string, contributionKey: string): string {
  id(originalSourceKey)
  id(contributionKey)
  return `bi1:${originalSourceKey}:${contributionKey}`
}
export function stockBytes(operation: StockOperation): Buffer {
  return Buffer.from(
    canonical({
      barcode: operation.barcode,
      location: operation.location,
      part: operation.part,
      quantity: operation.quantity,
    }),
  )
}
export function decodePlan(bytes: Buffer, digest: Buffer): StockPlan {
  verifyBytes(bytes, digest)
  const value = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  record(value, [
    'version',
    'deploymentId',
    'targetId',
    'contextId',
    'epoch',
    'build',
    'continuity',
    'capability',
    'sourceId',
    'originalSourceKey',
    'operations',
  ])
  if (
    canonical(value) !== bytes.toString('utf8') ||
    value.version !== 'bench-stock-plan/1' ||
    value.build !== EXECUTOR_BUILD ||
    value.capability !== CAPABILITY ||
    typeof value.continuity !== 'string' ||
    !value.continuity ||
    value.continuity.length > 256
  )
    throw new Error('unsupported_stock_plan')
  for (const key of [
    'deploymentId',
    'targetId',
    'contextId',
    'epoch',
    'sourceId',
    'originalSourceKey',
  ])
    id(value[key])
  if (!Array.isArray(value.operations) || !value.operations.length || value.operations.length > 100)
    throw new Error('invalid_stock_scope')
  const operations = new Set(),
    contributions = new Set()
  for (const operation of value.operations) {
    record(operation, [
      'operationKey',
      'contributionKey',
      'part',
      'location',
      'quantity',
      'barcode',
    ])
    id(operation.operationKey)
    id(operation.contributionKey)
    pk(operation.part)
    if (operation.location !== null) pk(operation.location)
    if (
      typeof operation.quantity !== 'string' ||
      !new RegExp(Quantity.pattern!).test(operation.quantity) ||
      operation.barcode !==
        contributionBarcode(value.originalSourceKey as string, operation.contributionKey)
    )
      throw new Error('invalid_stock_values')
    if (operations.has(operation.operationKey) || contributions.has(operation.contributionKey))
      throw new Error('duplicate_stock_scope')
    operations.add(operation.operationKey)
    contributions.add(operation.contributionKey)
  }
  return value as unknown as StockPlan
}
export function encodePlan(plan: StockPlan): { bytes: Buffer; digest: Buffer } {
  const bytes = Buffer.from(canonical(plan)),
    digest = sha256(bytes)
  decodePlan(bytes, digest)
  return { bytes, digest }
}
