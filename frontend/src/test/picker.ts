import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

type Name = string | RegExp

/** The searchable picker named `name`, in `container` or the document. */
export function picker(name: Name, container: HTMLElement = document.body) {
  return within(container).getByRole('combobox', { name })
}

/** An option of the open picker's menu, never a native select's. */
async function menuOption(option: Name) {
  const menu = await screen.findByRole('listbox')
  return within(menu).getByRole('option', { name: option })
}

/** Opens the picker named `name` and picks the option named `option`. */
export async function pickOption(
  user: UserEvent,
  name: Name,
  option: Name,
  container: HTMLElement = document.body,
) {
  await user.click(picker(name, container))
  await user.click(await menuOption(option))
}

/** Types `search` into the picker named `name`, then picks the option named `option`. */
export async function searchAndPick(
  user: UserEvent,
  name: Name,
  search: string,
  option: Name,
  container: HTMLElement = document.body,
) {
  await user.type(picker(name, container), search)
  await user.click(await menuOption(option))
}

/** The option names the open picker lists. */
export function listedOptions() {
  return within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((option) => option.textContent)
}

/** What the picker named `name` shows: its chosen value, or its placeholder. */
export function pickerText(name: Name, container: HTMLElement = document.body) {
  const control = picker(name, container).closest('[class*="control"]')
  return control?.textContent ?? ''
}
