/**
 * What a session drawer needs to come back after Processing remounts for a saved answer: the
 * answer's reload re-keys Processing in `Batch`, which drops its state. `Batch` owns one store per
 * batch, above that key.
 *
 * Its lifetime is one reload. Processing arms it once an answer is confirmed, just before the
 * reload. A reload that re-keys Processing carries it before the old Processing unmounts, and the
 * next Processing mount reads what was carried, on the same route only, then clears the store
 * whatever its route. Processing disarms it when it unmounts, so after a reload that fails or is
 * skipped, nothing is left for a later reload from another tab to carry.
 */
export type DrawerRestore = {
  /** The Processing route the drawer was open on. */
  route: string
  jobId: string
  /** Focus moves to the drawer's next question, as it would have without the remount. */
  focusNext: boolean
}

export function createDrawerRestore() {
  let armed: DrawerRestore | null = null
  let carried: DrawerRestore | null = null

  return {
    /** What the reload carried, read without consuming so a render can initialise state purely. */
    peek: () => carried,
    /** Arms the drawer for the reload that follows a confirmed answer. */
    set(value: DrawerRestore) {
      armed = value
    },
    /** Called by the reload that re-keys Processing, so the next mount brings the drawer back. */
    carry() {
      carried = armed
      armed = null
    },
    /** Drops an armed drawer that no reload carried; what was carried stays for the next mount. */
    disarm() {
      armed = null
    },
    /** Every Processing mount clears the store once it has read it. */
    clear() {
      armed = null
      carried = null
    },
  }
}

export type DrawerRestoreStore = ReturnType<typeof createDrawerRestore>
