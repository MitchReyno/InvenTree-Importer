import { useLayoutEffect, useRef, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import {
  Breadcrumb,
  type BreadcrumbItem,
  dottedGround,
  linkTouchArea,
  media,
  onFadingDown,
  onWholeWindow,
} from '#/components/ui'
import { useMastheadStyle } from '#/theme/masthead-style'
import { DevModeButton } from './DevModeButton'
import { ElectronicsCurrent } from './ElectronicsCurrent'

type MastheadProps = {
  breadcrumb?: BreadcrumbItem[]
  /** Workflow activity, the connection's server menu and the Settings button. */
  status?: ReactNode
}

/** One bar with the electronics current: wordmark, Dev mode button, breadcrumb, then the status group. */
export function Masthead({ breadcrumb, status }: MastheadProps) {
  const { style } = useMastheadStyle()
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
      {style === 'bar' && <ElectronicsCurrent />}
      <Row>
        <Lead ref={lead}>
          <Wordmark href="#" aria-label="Bench Intake, Batches">
            Bench <span>Intake</span>
          </Wordmark>
          <DevModeButton />
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
 * The fades shrink to fit a narrow gap, and close entirely when there is none. The stops and
 * the bar's height go on the document root, where Fading down's page-level mask reads them too.
 */
function fitCurrentToText({ header, lead, end }: MastheadElements) {
  const bar = header.getBoundingClientRect()
  const clearStart = lead.getBoundingClientRect().right - bar.left + TEXT_CLEARANCE_PX
  const clearEnd = end.getBoundingClientRect().left - bar.left - TEXT_CLEARANCE_PX
  const gap = Math.max(0, clearEnd - clearStart)
  const share = Math.min(1, gap / (FADE_IN_PX + FADE_OUT_PX))
  const stops = {
    '--masthead-height': bar.height,
    '--current-clear-start': clearStart,
    '--current-opaque-start': clearStart + FADE_IN_PX * share,
    '--current-opaque-end': clearEnd - FADE_OUT_PX * share,
    '--current-clear-end': gap > 0 ? clearEnd : clearStart,
  }
  for (const [name, value] of Object.entries(stops)) {
    document.documentElement.style.setProperty(name, `${Math.round(value)}px`)
  }
}

const Header = styled.header`
  position: relative;
  overflow: hidden;
  ${dottedGround}
  border-bottom: 1px solid ${color.line};

  /* The field shows through a translucent, blurred bar. */
  ${onWholeWindow} & {
    background-image: none;
    /* literal-allowed: the bar's translucency from the canvas; no opacity token has it */
    background-color: color-mix(in srgb, ${color.surface} 70%, transparent);
    /* literal-allowed: the bar's blur from the canvas; no blur token exists */
    backdrop-filter: blur(8px);
  }

  /* The fading band draws the ground behind the bar, which keeps none of its own. */
  ${onFadingDown} & {
    background: none;
    border-bottom: 0;
  }
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
