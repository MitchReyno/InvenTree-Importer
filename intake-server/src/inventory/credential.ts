import type { InventoryCredentialDto } from '@invimport/contracts'

/** A replacement read token on disk and when it was written. */
export interface SavedCredential {
  token: string
  savedAt: string
}

/**
 * The read token inventory reads use, swapped whole on replace or revert. The transport asks for
 * it per request, so a read already sent keeps the token it started with.
 */
export class CredentialHolder {
  readonly #environment: string
  #saved: SavedCredential | null

  constructor(environment: string, saved: SavedCredential | null) {
    this.#environment = environment
    this.#saved = saved
  }

  current(): string {
    return this.#saved?.token ?? this.#environment
  }

  /** What Settings may know: the source and save time, never the token. */
  state(): InventoryCredentialDto {
    if (!this.#saved) {
      return { credential_source: 'environment', credential_saved_at: null }
    }
    return { credential_source: 'saved', credential_saved_at: this.#saved.savedAt }
  }

  replace(saved: SavedCredential) {
    this.#saved = saved
  }

  revert() {
    this.#saved = null
  }
}
