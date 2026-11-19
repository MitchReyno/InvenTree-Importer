import { Fragment } from 'react'
import styled, { css } from 'styled-components'
import { groundBehindOnField } from './field'
import { color, icon, radius, size, space, type, typeVar } from '#/theme/generated/tokens'
import { AiMark } from './AiMark'
import { BackIcon } from './icons'
import { media } from './media'

export type SettingsSubsection = {
  id: string
  label: string
  href: string
}

export type SettingsSection = {
  id: string
  label: string
  href: string
  /** The section where a person meets the agents carries the AI mark. */
  agent?: boolean
  /** Links to parts of the section, listed under it while it is open. */
  subsections?: SettingsSubsection[]
}

type SettingsNavProps = {
  /** The screen that opened Settings, such as "Mouser 3381-22 › Processing", or Batches. */
  back: { label: string; href: string }
  sections: SettingsSection[]
  current: string
  /** The open section's subsection the route points at, if any. */
  currentSubsection?: string
  /** The heading's level; the page's own `h1` usually names the section beside the nav. */
  headingLevel?: 'h1' | 'h2'
}

/** The Settings page's section list, after a link back to where the person came from. */
export function SettingsNav({
  back,
  sections,
  current,
  currentSubsection,
  headingLevel = 'h2',
}: SettingsNavProps) {
  return (
    <Nav aria-label="Settings">
      <Back href={back.href}>
        <BackIcon />
        Back to {back.label}
      </Back>
      <Heading as={headingLevel}>Settings</Heading>
      {sections.map((section) => (
        <Fragment key={section.id}>
          <Section href={section.href} aria-current={section.id === current ? 'page' : undefined}>
            {section.agent ? <AiMark size="sm">{section.label}</AiMark> : section.label}
          </Section>
          {section.id === current && section.subsections && (
            <Subsections role="group" aria-label={`${section.label} sections`}>
              {section.subsections.map((subsection) => (
                <Subsection
                  key={subsection.id}
                  href={subsection.href}
                  aria-current={subsection.id === currentSubsection ? 'location' : undefined}
                >
                  {subsection.label}
                </Subsection>
              ))}
            </Subsections>
          )}
        </Fragment>
      ))}
    </Nav>
  )
}

const Nav = styled.nav`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  min-width: 0;
  ${groundBehindOnField}
`

const link = css`
  display: flex;
  align-items: center;
  gap: ${space[4]};
  padding: ${space[4]} ${space[5]};
  border-radius: ${radius.input};
  text-decoration: none;
`

const Back = styled.a`
  ${link}
  margin-bottom: ${space[6]};
  color: ${color.muted};
  font-size: ${typeVar.small.size};
  svg {
    flex: none;
    width: ${icon.sm};
    height: ${icon.sm};
  }
  &:hover {
    background: ${color.surface2};
  }
`

const Heading = styled.h2`
  margin: 0 0 ${space[4]} ${space[5]};
  ${type.h1}
`

const Section = styled.a`
  ${link}
  color: ${color.fg};
  /* literal-allowed: a nav item reads one step heavier than body text; no medium weight token */
  font-weight: 500;
  &:hover {
    background: ${color.surface2};
  }
  &[aria-current='page'] {
    background: ${color.accentWeak};
    font-weight: ${typeVar.bodyStrong.weight};
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const Subsections = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  margin: 0 0 ${space[3]} ${space[9]};
  padding-left: ${space[4]};
  border-left: 1px solid ${color.line};
`

const Subsection = styled.a`
  ${link}
  padding-block: ${space[3]};
  color: ${color.muted};
  font-size: ${typeVar.small.size};
  &:hover {
    background: ${color.surface2};
    color: ${color.fg};
  }
  &[aria-current='location'] {
    background: ${color.surface2};
    color: ${color.fg};
    font-weight: ${typeVar.bodyStrong.weight};
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`
