import { act } from '@testing-library/react'
import { debugModeController } from '#/debug/debug-mode'

/** Turns debug mode on or off for a test; the controller is shared by the whole document. */
export function setDebugMode(enabled: boolean) {
  act(() => debugModeController().setEnabled(enabled))
}
