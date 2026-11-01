import styled, { css } from 'styled-components'

export const Button = styled.button`
  cursor: pointer;
  min-height: 44px;
  padding: 9px 14px;
  color: #164a93;
  background: #edf3fc;
  border: 1px solid #b9cde7;
  border-radius: 6px;
  touch-action: manipulation;
  &:disabled { cursor: default; opacity: .55; }
`
export const Link = styled.a`color: #164a93; touch-action: manipulation;`
export const Panel = styled.section`
  padding: 16px;
  background: white;
  border: 1px solid #d5dce5;
  border-radius: 6px;
  margin-bottom: 12px;
  min-width: 0;
`
export const PageTitle = styled.h1`
  font-size: clamp(23px, 3vw, 30px);
  line-height: 1.2;
  margin: 12px 0;
  overflow-wrap: anywhere;
`
export const Heading = styled.h2`font-size: 16px; margin: 0 0 12px;`
export const Subheading = styled.h3`font-size: 15px; margin: 0 0 10px;`
export const Paragraph = styled.p`line-height: 1.5;`
export const Small = styled.small`
  display: block;
  font-size: 12px;
  font-weight: 400;
  color: #526179;
  line-height: 1.6;
  overflow-wrap: anywhere;
`
export const Form = styled.form`display: grid; gap: 12px;`
export const Fieldset = styled.fieldset`
  border: none; padding: 0; margin: 0; min-width: 0; display: grid; gap: 12px;
  &:disabled input, &:disabled textarea, &:disabled select {
    background: #f3f5f8; color: #526179; border-style: dashed; cursor: not-allowed;
  }
`
export const Label = styled.label`display: grid; gap: 7px; font-size: 14px; font-weight: 550;`
const control = css`
  width: 100%; min-width: 0; min-height: 44px; padding: 10px;
  border: 1px solid #acbacb; border-radius: 5px; background: #fff; color: #233349;
`
export const Input = styled.input`${control}`
export const Select = styled.select`${control}`
export const TextArea = styled.textarea`${control} min-height: 90px; resize: vertical;`
export const Summary = styled.summary`cursor: pointer; min-height: 44px; padding: 8px 0;`
export const HeadingRow = styled.div`
  display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
  ${Heading} { margin-bottom: 8px; }
`
export const Caption = styled(Paragraph)`color: #526179; font-size: 13px; margin: 8px 0 16px;`
export const Eyebrow = styled(Paragraph)`font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; color: #526179;`
export const Intro = styled(Paragraph)`max-width: 700px; color: #526179;`
export const CheckboxLabel = styled(Label)`display: flex; align-items: center; ${Input} { width: 20px; }`
export const Field = styled.div`
  display: grid; gap: 10px; padding: 12px; border: 1px solid #d5dce5; background: #f7f9fc; border-radius: 6px;
`
export const Notice = styled(Paragraph)`
  padding: 16px; border: 1px solid #d7b56a; background: #fff4d9; border-radius: 6px; margin-bottom: 18px;
`
export const ErrorNotice = styled.div`
  padding: 16px; border: 1px solid #cd8585; background: #fff0f0; border-radius: 6px; margin-bottom: 18px;
`
