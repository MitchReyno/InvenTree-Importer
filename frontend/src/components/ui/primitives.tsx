import styled, { css } from 'styled-components'
import { color, radius, space, type } from '../../theme/generated/tokens'
import { media } from './media'

export const Button = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${space[3]};
  cursor: pointer;
  min-height: 32px;
  padding: 7px ${space[6]};
  color: ${color.fg};
  background: ${color.surface};
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  font-weight: 500;
  line-height: 1.2;
  touch-action: manipulation;
  transition: background-color 80ms linear;
  &:hover:not(:disabled) {
    background: ${color.surface2};
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  ${media.compact} {
    min-height: 44px;
  }
`
export const Link = styled.a`
  color: ${color.accent};
  touch-action: manipulation;
`
export const Panel = styled.section`
  padding: ${space[7]} ${space[8]};
  background: ${color.surface};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  margin-bottom: ${space[6]};
  min-width: 0;
`
export const PageTitle = styled.h1`
  ${type.h1}
  margin: ${space[6]} 0;
  overflow-wrap: anywhere;
`
export const Heading = styled.h2`
  ${type.h2}
  margin: 0 0 ${space[6]};
`
export const Subheading = styled.h3`
  ${type.h3}
  margin: 0 0 ${space[5]};
`
export const Paragraph = styled.p`
  line-height: 1.45;
`
export const Small = styled.small`
  display: block;
  font-size: 12.5px;
  font-weight: 400;
  color: ${color.muted};
  line-height: 18px;
  overflow-wrap: anywhere;
`
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
  font-size: 12.5px;
  font-weight: 600;
`
const control = css`
  width: 100%;
  min-width: 0;
  min-height: 32px;
  padding: 7px 9px;
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.input};
  background: ${color.surface};
  color: ${color.fg};
  font-size: 14px;
  font-weight: 400;
  &[aria-invalid='true'] {
    border-color: ${color.bad};
  }
  ${media.compact} {
    min-height: 44px;
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
export const Summary = styled.summary`
  cursor: pointer;
  min-height: 32px;
  padding: ${space[4]} 0;
  ${media.compact} {
    min-height: 44px;
  }
`
export const HeadingRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: ${space[6]};
  flex-wrap: wrap;
  ${Heading} {
    margin-bottom: ${space[4]};
  }
`
export const Caption = styled(Paragraph)`
  color: ${color.muted};
  font-size: 12.5px;
  margin: ${space[4]} 0 ${space[8]};
`
export const Eyebrow = styled(Paragraph)`
  ${type.label}
  color: ${color.muted};
`
export const Intro = styled(Paragraph)`
  max-width: 700px;
  color: ${color.muted};
`
export const CheckboxLabel = styled(Label)`
  display: flex;
  align-items: center;
  font-weight: 500;
  ${Input} {
    width: 20px;
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
export const Notice = styled(Paragraph)`
  padding: ${space[5]} ${space[7]};
  border: 1px solid transparent;
  background: ${color.warnWeak};
  border-radius: ${radius.card};
  margin-bottom: ${space[9]};
`
export const ErrorNotice = styled.div`
  padding: ${space[5]} ${space[7]};
  border: 1px solid ${color.bad};
  background: ${color.badWeak};
  border-radius: ${radius.card};
  margin-bottom: ${space[9]};
`
