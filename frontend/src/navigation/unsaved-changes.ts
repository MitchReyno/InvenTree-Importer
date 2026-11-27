/** An unsaved change its editor can name and drop, for the batch's notice when saved values can't be read. */
export interface UnsavedChange {
  /** What the change is to, such as "Lot 3 · quantity" or "the batch settings". */
  label: string
  /** Drops the change; its editor reports itself clean as it does. */
  discard: () => void
}

/**
 * Reports whether an editor holds unsaved work, with the changes it can name and drop. Work it
 * can't name (an unsent message, a command awaiting confirmation) is dirty but listed nowhere.
 */
export type DirtyReport = (dirty: boolean, changes?: readonly UnsavedChange[]) => void

/** Reports to a parent, passing the named changes only when there are some. */
export function reportDirty(
  report: DirtyReport | undefined,
  dirty: boolean,
  changes: readonly UnsavedChange[],
) {
  if (changes.length > 0) {
    report?.(dirty, changes)
  } else {
    report?.(dirty)
  }
}
