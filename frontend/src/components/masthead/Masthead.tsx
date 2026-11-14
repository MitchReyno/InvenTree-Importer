import { useLayoutEffect, useRef, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import { Breadcrumb, type BreadcrumbItem, media, linkTouchArea } from '#/components/ui'
import { DevBadge } from './DevBadge'
import { ElectronicsCurrent } from './ElectronicsCurrent'

type MastheadProps = {
  breadcrumb?: BreadcrumbItem[]
  /** Workflow activity, the connection's server menu and the Settings button. */
  status?: ReactNode
}

/** One bar over the electronics current: wordmark, Dev badge, breadcrumb, then the status group. */
export function Masthead({ breadcrumb, status }: MastheadProps) {
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
          <DevBadge shorten />
          {breadcrumb && breadcrumb.length > 0 && (
            <Crumbs data-compact="hidden">
              <span aria-hidden="true">/</span>
              <Breadcrumb items={breadcrumb} />
            </Crumbs>
          )}
        </Lead>
        <Spacer />
        <End ref={end}>{status ?? <WorkflowLabel>Manual workflow</WorkflowLabel>}</End>
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

/** At phone width the brand side gives way to the status buttons, which never clip. */
const Lead = styled.div`
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: ${space[6]};
  min-width: 0;
  ${media.compact} {
    gap: ${space[4]};
  }
`

const End = styled.div`
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
  ${media.compact} {
    flex: none;
  }
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: ${space[6]};
  max-width: 100%;
  ${media.compact} {
    gap: ${space[4]};
  }
`

const Wordmark = styled.a`
  ${type.brand}
  color: ${color.fg};
  white-space: nowrap;
  text-decoration: none;
  ${linkTouchArea}
  /* The phone canvas sets the brand smaller; below 360px it ellipsises before the buttons clip.
     The clip margin keeps the touch area's full height. */
  ${media.compact} {
    min-width: 0;
    overflow: clip;
    overflow-clip-margin: ${space[4]};
    text-overflow: ellipsis;
    /* literal-allowed: the phone brand size from the canvas; no type token has it */
    font-size: 19px;
  }
  span {
    font-weight: 450;
  }
`

/** The trail follows the Dev badge after a separator; the current crumb stays `fg`, as on the canvas. */
const Crumbs = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[3]};
  min-width: 0;
  flex: 0 1 auto;
  color: ${color.muted};
  overflow: hidden;
  /* Room for the link's focus ring inside the clipped box. */
  margin: -4px;
  padding: ${space[2]};
  ${media.compact} {
    display: none;
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
