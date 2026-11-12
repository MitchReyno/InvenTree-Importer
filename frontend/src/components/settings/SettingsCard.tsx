import styled from 'styled-components'
import { color, radius } from '#/theme/generated/tokens'

/** A card of `SettingRow`s on the Settings page; name it with `aria-label`. */
export const SettingsCard = styled.section`
  min-width: 0;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`
