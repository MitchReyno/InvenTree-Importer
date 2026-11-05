import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, space, type } from '../../theme/generated/tokens'
import type { ThemeController } from '../../theme/theme'
import { Breadcrumb, type BreadcrumbItem } from '../ui/Breadcrumb'
import { media } from '../ui/media'
import { ElectronicsCurrent } from './ElectronicsCurrent'
import { MastheadMenu } from './MastheadMenu'

type MastheadProps = {
  breadcrumb?: BreadcrumbItem[]
  /** Workflow activity, connection status and Open InvenTree. */
  status?: ReactNode
  themeController?: ThemeController
}

/** One bar over the electronics current: wordmark, Dev badge, breadcrumb, status, menu. */
export function Masthead({ breadcrumb, status, themeController }: MastheadProps) {
  return (
    <Header>
      <ElectronicsCurrent />
      <Row>
        <Wordmark href="#" aria-label="Bench Intake, Batches">
          Bench <span>Intake</span>
        </Wordmark>
        <DevBadge>Dev mode</DevBadge>
        {breadcrumb && breadcrumb.length > 0 && (
          <Crumbs data-compact="hidden">
            <Breadcrumb items={breadcrumb} />
          </Crumbs>
        )}
        <Spacer />
        {status ?? <WorkflowLabel>Manual workflow</WorkflowLabel>}
        <MastheadMenu themeController={themeController} />
      </Row>
    </Header>
  )
}

const Header = styled.header`
  position: relative;
  overflow: hidden;
  background-color: ${color.mastheadGround};
  background-image: radial-gradient(circle, ${color.mastheadDot} 1px, transparent 1.4px);
  background-size: 16px 16px;
  border-bottom: 1px solid ${color.line};
`

const Row = styled.div`
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  min-height: 56px;
  padding: ${space['2-5']} ${space[4]};
`

const Wordmark = styled.a`
  ${type.brand}
  color: ${color.fg};
  white-space: nowrap;
  text-decoration: none;
  span {
    font-weight: 450;
  }
`

const DevBadge = styled.span`
  padding: 2px ${space[2]};
  border: 1px solid ${color.devLine};
  border-radius: ${radius.pill};
  background: ${color.devBg};
  color: ${color.devFg};
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
`

const Crumbs = styled.div`
  min-width: 0;
  flex: 0 1 auto;
  ${media.compact} {
    display: none;
  }
`

const Spacer = styled.span`
  flex: 1;
`

const WorkflowLabel = styled.span`
  padding: 3px ${space['2-5']};
  border: 1px solid ${color.line};
  border-radius: ${radius.pill};
  background: ${color.surface};
  color: ${color.muted};
  font-size: 12.5px;
`
