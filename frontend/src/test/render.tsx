import { render as renderUi, type RenderOptions } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { ConfirmationProvider } from '#/components/ui'
import type { ServerScope } from '#/queries/scope'
import { ApiClientsProvider } from '#/components/clients/ApiClientsProvider'
import { BatchCommandsProvider } from '#/components/batches/BatchCommandsProvider'
import type { BatchCommands } from '#/capture/batch-commands'
import { batchCommands } from './batch-commands'
import { type ApiClients } from '#/clients/api-clients'

export const fixtureScope: ServerScope = {
  origin: 'http://localhost:3000',
  actorId: '50000000-0000-4000-8000-000000000005',
  targetId: 'a0000000-0000-4000-8000-00000000000a',
  targetContextId: '60000000-0000-4000-8000-000000000006',
}

/** Use the same explicit query provider as production, with a fresh cache per render. */
export function render(
  ui: ReactElement,
  {
    clients = {},
    commands,
    ...options
  }: RenderOptions & { clients?: ApiClients; commands?: Partial<BatchCommands> } = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerStateProvider scope={fixtureScope}>
        <ConfirmationProvider>
          <ApiClientsProvider value={clients}>
            <BatchCommandsProvider value={batchCommands(commands)}>
              {children}
            </BatchCommandsProvider>
          </ApiClientsProvider>
        </ConfirmationProvider>
      </ServerStateProvider>
    )
  }

  return renderUi(ui, { wrapper: Wrapper, ...options })
}
