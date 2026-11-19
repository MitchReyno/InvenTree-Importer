import type { ConnectionStatusDto, HeaderWorkDto, HeaderWorkQueryDto } from '@invimport/contracts'

export interface HeaderClient {
  connection: () => Promise<ConnectionStatusDto>
  /** Probes the target now; the server reuses a check in flight and allows one every 5 seconds. */
  checkConnection: () => Promise<ConnectionStatusDto>
  work: (query?: HeaderWorkQueryDto) => Promise<HeaderWorkDto>
}
