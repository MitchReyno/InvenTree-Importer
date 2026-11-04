import type { ReactNode } from 'react'
import styled from 'styled-components'
import { ElectronicsCurrent } from './ElectronicsCurrent'

/** Decorative brand header; scoped application status controls and navigation occupy its slots. */
export function Masthead({ actions, children }: { actions?: ReactNode; children?: ReactNode }) {
  return (
    <Header>
      <ElectronicsCurrent />
      <TopRow>
        <BrandGroup>
          <Brand>
            Bench <span>Intake</span>
          </Brand>
          <DevBadge>Dev mode</DevBadge>
        </BrandGroup>
        <Actions>{actions ?? <WorkflowLabel>Manual workflow</WorkflowLabel>}</Actions>
      </TopRow>
      {children}
    </Header>
  )
}

const Header = styled.header`
  position: relative;
  background-color: #f3f5f8;
  background-image: radial-gradient(circle, #dde3eb 1px, transparent 1.4px);
  background-size: 16px 16px;
  overflow: hidden;
`

const TopRow = styled.div`
  position: relative;
  min-height: 76px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  @media (max-width: 700px) {
    min-height: 60px;
    font-size: 12px;
  }
`

const BrandGroup = styled.div`
  padding: 0 12px;
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
`

const Brand = styled.strong`
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

const DevBadge = styled.span`
  padding: 2px 8px;
  color: #644813;
  background: #fff3d8;
  border: 1px solid #e7d09c;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
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

const Actions = styled.div`
  position: relative;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`
