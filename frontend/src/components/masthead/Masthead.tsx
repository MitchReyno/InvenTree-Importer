import styled from 'styled-components'
import { ElectronicsCurrent } from './ElectronicsCurrent'

/** Application masthead: brand and workflow label over a dot grid and drifting parts. */
export function Masthead() {
  return (
    <Header>
      <ElectronicsCurrent />
      <Brand>
        Bench <span>Intake</span>
      </Brand>
      <WorkflowLabel>Manual workflow</WorkflowLabel>
    </Header>
  )
}

const Header = styled.header`
  position: relative;
  min-height: 64px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid #d5dce5;
  background-color: #f3f5f8;
  background-image: radial-gradient(circle, #dde3eb 1px, transparent 1.4px);
  background-size: 16px 16px;
  overflow: hidden;
  @media (max-width: 700px) {
    min-height: 52px;
    font-size: 12px;
  }
`

const Brand = styled.strong`
  position: relative;
  font-size: 22px;
  font-weight: 750;
  color: #233349;
  span {
    font-weight: 450;
  }
  @media (max-width: 700px) {
    font-size: 20px;
  }
`

const WorkflowLabel = styled.span`
  position: relative;
  padding: 6px 12px;
  color: #526179;
  background: #f3f5f8;
  border: 1px solid #d5dce5;
  border-radius: 999px;
  font-size: 13px;
  @media (max-width: 700px) {
    font-size: 12px;
  }
`
