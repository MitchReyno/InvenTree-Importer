import type {
  ConnectionStatusDto,
  HeaderWorkDto,
  HeaderWorkQueryDto,
  InventoryCredentialDto,
  InventoryCredentialReplaceDto,
} from '@invimport/contracts'

export interface HeaderClient {
  connection: () => Promise<ConnectionStatusDto>
  /** Probes the target now; the server reuses a check in flight and allows one every 5 seconds. */
  checkConnection: () => Promise<ConnectionStatusDto>
  work: (query?: HeaderWorkQueryDto) => Promise<HeaderWorkDto>
  /** Checks a new read token against InvenTree, then saves it; the token never comes back. */
  replaceInventoryCredential: (
    input: InventoryCredentialReplaceDto,
  ) => Promise<InventoryCredentialDto>
  /** Deletes the saved token, so reads use the server's environment token again. */
  revertInventoryCredential: () => Promise<InventoryCredentialDto>
}
