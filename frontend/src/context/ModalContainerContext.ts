import { createContext, useContext } from 'react'

/**
 * The open modal's surface, provided by `ModalFrame`. A popover opened inside a modal portals
 * into it, so it stacks above the modal and stays inside its focus scope.
 */
export const ModalContainerContext = createContext<HTMLElement | null>(null)

export function useModalContainer() {
  return useContext(ModalContainerContext)
}
