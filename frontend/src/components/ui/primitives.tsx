import styled, { css } from 'styled-components'
import { color, radius, size, space, type, typeVar } from '../../theme/generated/tokens'
import { media } from './media'

/** Under compact, an inline link keeps its line height and gains an invisible 44px hit area. */
export const linkTouchArea = css`
  ${media.compact} {
    position: relative;
    &::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      width: max(100%, ${size.touch});
      height: ${size.touch};
      transform: translate(-50%, -50%);
    }
  }
`

export const Link = styled.a`
  color: ${color.accent};
  touch-action: manipulation;
  ${linkTouchArea}
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
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.small.weight};
  color: ${color.muted};
  line-height: ${typeVar.small.lineHeight};
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
export const Summary = styled.summary`
  cursor: pointer;
  min-height: ${size.control};
  padding: ${space[4]} 0;
  ${media.compact} {
    min-height: ${size.touch};
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
