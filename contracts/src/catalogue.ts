import { Type, type Static } from '@sinclair/typebox'
import { Id, PositivePk } from './scalars.ts'
import { label, object } from './capture-primitives.ts'

/**
 * Bounded read-only catalogue projections for searchable reference pickers. A result is an
 * observation of what the configured target returned, never a selection or an inventory record
 * retained by the application; selecting one still uses the observation command.
 */
export const CATALOGUE_QUERY_MAX_CHARACTERS = 100
export const CATALOGUE_SEARCH_PAGE_SIZE = 50
export const CATALOGUE_CANDIDATE_LIMIT = 500

export const CatalogueModel = Type.Union([Type.Literal('location'), Type.Literal('supplier')])
export const CatalogueQuery = object({
  q: Type.String({
    minLength: 1,
    maxLength: CATALOGUE_QUERY_MAX_CHARACTERS,
    pattern: '^[^\\u0000-\\u001f\\u007f]*$',
  }),
})

const description = Type.String({ maxLength: 2048 })
export const CatalogueLocation = object({
  kind: Type.Literal('location'),
  pk: PositivePk,
  name: label,
  description,
  /** Upstream hierarchy path, shown to distinguish similarly named locations. */
  path: Type.String({ maxLength: 2048 }),
  parent_pk: Type.Union([PositivePk, Type.Null()]),
  structural: Type.Boolean(),
})
export const CatalogueSupplier = object({
  kind: Type.Literal('supplier'),
  pk: PositivePk,
  name: label,
  description,
  manufacturer: Type.Boolean(),
})
export const CatalogueRecord = Type.Union([CatalogueLocation, CatalogueSupplier])

/** `loaded` records were read out of `total` reported by the target; truncated means partial. */
export const CatalogueCoverage = object({
  loaded: Type.Integer({ minimum: 0 }),
  total: Type.Integer({ minimum: 0 }),
  truncated: Type.Boolean(),
})

export const CatalogueSearch = object({
  model: CatalogueModel,
  target_context_id: Id,
  query: CatalogueQuery.properties.q,
  results: Type.Array(CatalogueRecord, { maxItems: CATALOGUE_SEARCH_PAGE_SIZE }),
  coverage: CatalogueCoverage,
  /** Exact numeric-ID lookup is separate from text search and never fuzzy-substitutes. */
  exact_id: Type.Union([
    object({ status: Type.Literal('not_requested') }),
    object({ status: Type.Literal('not_found') }),
    object({ status: Type.Literal('found'), record: CatalogueRecord }),
  ]),
})

export const CatalogueCandidates = object({
  model: CatalogueModel,
  target_context_id: Id,
  candidates: Type.Array(CatalogueRecord, { maxItems: CATALOGUE_CANDIDATE_LIMIT }),
  coverage: CatalogueCoverage,
})

export const catalogueSchemas = {
  CatalogueModel,
  CatalogueQuery,
  CatalogueLocation,
  CatalogueSupplier,
  CatalogueRecord,
  CatalogueCoverage,
  CatalogueSearch,
  CatalogueCandidates,
}

export type CatalogueModelDto = Static<typeof CatalogueModel>
export type CatalogueRecordDto = Static<typeof CatalogueRecord>
export type CatalogueSearchDto = Static<typeof CatalogueSearch>
export type CatalogueCandidatesDto = Static<typeof CatalogueCandidates>
export type CatalogueCoverageDto = Static<typeof CatalogueCoverage>
