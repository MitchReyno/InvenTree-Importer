import styled, { css } from 'styled-components'
import { color, icon, radius, size, space, typeVar } from '#/theme/generated/tokens'
import { media } from '#/components/ui/media'

export const Form = styled.form`
  display: grid;
  gap: ${space[6]};
`
export const Fieldset = styled.fieldset`
  border: none;
  padding: 0;
  margin: 0;
  min-width: 0;
  display: grid;
  gap: ${space[6]};
  &:disabled input,
  &:disabled textarea,
  &:disabled select {
    background: ${color.surface2};
    color: ${color.muted};
    border-style: dashed;
    cursor: not-allowed;
  }
`
export const Label = styled.label`
  display: grid;
  gap: ${space[2]};
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.bodyStrong.weight};
`
const control = css`
  width: 100%;
  min-width: 0;
  min-height: ${size.control};
  padding: calc(${space[4]} - 1px) calc(${space[5]} - 1px);
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.input};
  background: ${color.surface};
  color: ${color.fg};
  font-size: ${typeVar.body.size};
  font-weight: ${typeVar.body.weight};
  &[aria-invalid='true'] {
    border-color: ${color.bad};
  }
  &:disabled {
    border-style: dashed;
    background: ${color.surface2};
    color: ${color.muted};
    cursor: not-allowed;
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`
export const Input = styled.input`
  ${control}
`
export const Select = styled.select`
  ${control}
`
export const TextArea = styled.textarea`
  ${control}
  min-height: 84px;
  line-height: 1.45;
  resize: vertical;
`
export const CheckboxLabel = styled(Label)`
  display: flex;
  align-items: center;
  /* literal-allowed: a choice reads one step heavier than body text; no medium body weight token */
  font-weight: 500;
  ${Input} {
    width: ${icon.md};
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`
export const Field = styled.div`
  display: grid;
  gap: ${space[5]};
  padding: ${space[6]};
  border: 1px solid ${color.line};
  background: ${color.surface2};
  border-radius: ${radius.card};
`
