/**
 * What a session drawer needs to come back after Processing remounts for a saved answer: the
 * answer's reload re-keys Processing in `Batch`, which drops its state. `Batch` owns one store per
 * batch, above that key. Processing writes it once the answer is confirmed, just before the
 * reload, and the next Processing mount on the same route takes it once.
 */
export type DrawerRestore = {
  /** The Processing route the drawer was open on. */
  route: string
  jobId: string
  /** Focus moves to the drawer's next question, as it would have without the remount. */
  focusNext: boolean
}

export function createDrawerRestore() {
  let pending: DrawerRestore | null = null

  return {
    /** Read without consuming, so a render can initialise state purely. */
    peek: () => pending,
    set(value: DrawerRestore | null) {
      pending = value
    },
  }
}

export type DrawerRestoreStore = ReturnType<typeof createDrawerRestore>
