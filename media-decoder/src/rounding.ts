/**
 * Rounds halves to the even neighbour, as Python's `round` does, so values the skills' scripts
 * round come out the same here.
 */
export function roundHalfEven(value: number) {
  const floor = Math.floor(value)
  const fraction = value - floor
  if (fraction > 0.5) {
    return floor + 1
  }
  if (fraction < 0.5) {
    return floor
  }
  return floor % 2 === 0 ? floor : floor + 1
}
