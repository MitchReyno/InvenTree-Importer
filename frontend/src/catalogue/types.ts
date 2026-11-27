import type { batchDefaultsClient, catalogueClient } from '@invimport/contracts/client'

export type CatalogueClient = ReturnType<typeof catalogueClient>
export type BatchDefaultsClient = ReturnType<typeof batchDefaultsClient>
