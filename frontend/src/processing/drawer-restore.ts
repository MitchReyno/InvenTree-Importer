/**
 * What a session drawer needs to come back after Processing remounts for a saved answer: the
 * answer's reload re-keys Processing in `Batch`, which drops its state. `Batch` owns one store per
 * batch, above that key.
 *
 * Its lifetime is one reload. Processing arms it once an answer is confirmed, just before the
 * reload. Only a reload that re-keys Processing carries it, and the next Processing mount reads
 * what was carried, on the same route only, then clears the store whatever its route. A reload
 * that fails or is skipped never carries it, so the next mount just clears it.
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
    /** Arms the drawer for the reload that follows a confirmed answer; null disarms it. */
    set(value: DrawerRestore | null) {
      armed = value
    },
    /** Called by the reload that re-keys Processing, so the next mount brings the drawer back. */
    carry() {
      carried = armed
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
