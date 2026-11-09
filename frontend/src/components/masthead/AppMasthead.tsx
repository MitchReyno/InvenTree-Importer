import { useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, ServerScopeContext } from '#/queries/scope'
import { type BreadcrumbItem } from '#/components/ui'
import { Masthead } from './Masthead'

type BatchReader = (id: string) => Promise<{ title: string }>

type AppMastheadProps = {
  route: string | undefined
  readBatch?: BatchReader
  status: ReactNode
}

const BATCHES: BreadcrumbItem = { label: 'Batches', href: '#' }

const APP_PAGES: Record<string, string> = { settings: 'Agent settings', agents: 'Agents' }

/** Reads the open batch's title from the same cached capture read the batch screen uses. */
function useRouteBreadcrumb(route: string | undefined, readBatch?: BatchReader) {
  const scope = useContext(ServerScopeContext)
  const page = route ? APP_PAGES[route] : undefined
  const batchId = route && !page ? route.split('/')[0] : undefined
  const title = useQuery({
    queryKey: scope && batchId ? serverQueryKey(scope, 'capture', batchId) : ['no-batch'],
    queryFn: () => readBatch!(batchId!),
    enabled: Boolean(scope && batchId && readBatch),
    select: (batch) => batch.title,
  })

  if (page) {
    return [BATCHES, { label: page }]
  }
  if (batchId) {
    return [BATCHES, { label: title.data || 'Batch' }]
  }

  return [{ label: 'Batches' }]
}

export function AppMasthead({ route, readBatch, status }: AppMastheadProps) {
  const breadcrumb = useRouteBreadcrumb(route, readBatch)

  return <Masthead breadcrumb={breadcrumb} status={status} />
}
