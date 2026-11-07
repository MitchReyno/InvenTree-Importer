import { useLayoutEffect, useRef, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, space, type, typeVar } from '../../theme/generated/tokens'
import type { ThemeController } from '../../theme/theme'
import { Breadcrumb, type BreadcrumbItem } from '../ui/Breadcrumb'
import { media } from '../ui/media'
import { linkTouchArea } from '../ui/primitives'
import { visuallyHidden } from '../ui/VisuallyHidden'
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
  const header = useRef<HTMLElement>(null)
  const lead = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!header.current || !lead.current || !end.current || typeof ResizeObserver !== 'function') {
      return
    }
    const elements = { header: header.current, lead: lead.current, end: end.current }
    const observer = new ResizeObserver(() => fitCurrentToText(elements))
    observer.observe(elements.header)
    observer.observe(elements.lead)
    observer.observe(elements.end)

    return () => observer.disconnect()
  }, [])

  return (
    <Header ref={header}>
      <ElectronicsCurrent />
      <Row>
        <Lead ref={lead}>
          <Wordmark href="#" aria-label="Bench Intake, Batches">
            Bench <span>Intake</span>
          </Wordmark>
          <DevBadge>
            Dev<CompactHidden> mode</CompactHidden>
          </DevBadge>
          {breadcrumb && breadcrumb.length > 0 && (
            <Crumbs data-compact="hidden">
              <Breadcrumb items={breadcrumb} />
            </Crumbs>
          )}
        </Lead>
        <Spacer />
        <End ref={end}>
          {status ?? <WorkflowLabel>Manual workflow</WorkflowLabel>}
          <MastheadMenu themeController={themeController} />
        </End>
      </Row>
    </Header>
  )
}

// Clear space kept between the text and the first visible part.
const TEXT_CLEARANCE_PX = 16
const FADE_IN_PX = 140
const FADE_OUT_PX = 120

type MastheadElements = { header: HTMLElement; lead: HTMLElement; end: HTMLElement }

/**
 * Tells the current's mask where the text sits, so parts only show in the gap between.
 * The fades shrink to fit a narrow gap, and close entirely when there is none.
 */
function fitCurrentToText({ header, lead, end }: MastheadElements) {
  const bar = header.getBoundingClientRect()
  const clearStart = lead.getBoundingClientRect().right - bar.left + TEXT_CLEARANCE_PX
  const clearEnd = end.getBoundingClientRect().left - bar.left - TEXT_CLEARANCE_PX
  const gap = Math.max(0, clearEnd - clearStart)
  const share = Math.min(1, gap / (FADE_IN_PX + FADE_OUT_PX))
  const stops = {
    '--current-clear-start': clearStart,
    '--current-opaque-start': clearStart + FADE_IN_PX * share,
    '--current-opaque-end': clearEnd - FADE_OUT_PX * share,
    '--current-clear-end': gap > 0 ? clearEnd : clearStart,
  }
  for (const [name, value] of Object.entries(stops)) {
    header.style.setProperty(name, `${Math.round(value)}px`)
  }
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
  flex-wrap: nowrap;
  align-items: center;
  gap: ${space[6]};
  min-height: 56px;
  padding: ${space[5]} ${space[8]};
  /* One row at phone width: the shell already pads the page, and the status pills shrink first. */
  ${media.compact} {
    gap: ${space[4]};
    padding: ${space[5]} ${space[4]};
  }
`

const Lead = styled.div`
  display: flex;
  flex: 0 1 auto;
  ${media.compact} {
    flex: none;
  }
  align-items: center;
  gap: ${space[6]};
  min-width: 0;
`

const End = styled.div`
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: ${space[4]};
  max-width: 100%;
`

const Wordmark = styled.a`
  ${type.brand}
  color: ${color.fg};
  white-space: nowrap;
  text-decoration: none;
  ${linkTouchArea}
  span {
    font-weight: 450;
  }
`

const DevBadge = styled.span`
  padding: ${space[1]} ${space[4]};
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
  overflow: hidden;
  /* Room for the link's focus ring inside the clipped box. */
  margin: -4px;
  padding: ${space[2]};
  ${media.compact} {
    display: none;
  }
`

/** Read but not shown at phone width, so the badge says "Dev" and keeps its full name. */
const CompactHidden = styled.span`
  ${media.compact} {
    ${visuallyHidden}
  }
`

const Spacer = styled.span`
  flex: 1;
`

/** Without a status the bar says which workflow runs, as quiet text rather than a control. */
const WorkflowLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`
