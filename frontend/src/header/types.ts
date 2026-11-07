import type { ConnectionStatusDto, HeaderWorkDto, HeaderWorkQueryDto } from '@invimport/contracts'

export interface HeaderClient {
  connection: () => Promise<ConnectionStatusDto>
  work: (query?: HeaderWorkQueryDto) => Promise<HeaderWorkDto>
}
