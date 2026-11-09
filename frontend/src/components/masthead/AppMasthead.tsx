import type { ReactNode } from 'react'
import type { BreadcrumbItem } from '#/components/ui'
import { appPage } from '#/navigation/app-route'
import { Masthead } from './Masthead'

type AppMastheadProps = {
  route: string | undefined
  status: ReactNode
}

const BATCHES: BreadcrumbItem = { label: 'Batches', href: '#' }

const PAGE_LABEL = { settings: 'Agent settings', agents: 'Agents' } as const

/** Inside a batch the trail is "Batches" alone: the batch header names the batch. */
function routeBreadcrumb(route: string | undefined): BreadcrumbItem[] {
  const page = appPage(route)
  if (page) {
    return [BATCHES, { label: PAGE_LABEL[page] }]
  }
  if (route) {
    return [BATCHES]
  }

  return [{ label: 'Batches' }]
}

export function AppMasthead({ route, status }: AppMastheadProps) {
  return <Masthead breadcrumb={routeBreadcrumb(route)} status={status} />
}
