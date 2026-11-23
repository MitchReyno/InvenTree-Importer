import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import type { AgentSubsectionId } from '#/navigation/app-route'
import { onField } from '#/components/ui'

export const SUBSECTION_TITLE: Record<AgentSubsectionId, string> = {
  providers: 'Providers',
  sessions: 'Sessions',
  models: 'Provider and model per step',
  instructions: 'Instructions',
  descriptions: 'Descriptions and naming',
  tags: 'Tag suggestions',
  research: 'Web research',
}

type AgentSubsectionProps = {
  id: AgentSubsectionId
  /** One line under the heading; leave it out when the title says enough. */
  lead?: string
  /** What the subsection's autosave is doing, beside its heading. */
  status?: ReactNode
  children: ReactNode
}

/** The heading id a sub-nav link scrolls to and focuses. */
export function subsectionHeadingId(id: AgentSubsectionId) {
  return `agents-${id}`
}

/** One Settings › Agents subsection: its heading renders at once, before the settings load. */
export function AgentSubsection({ id, lead, status, children }: AgentSubsectionProps) {
  const headingId = subsectionHeadingId(id)

  return (
    <Section aria-labelledby={headingId}>
      <Head>
        <TitleRow>
          <Title id={headingId} tabIndex={-1}>
            {SUBSECTION_TITLE[id]}
          </Title>
          {status}
        </TitleRow>
        {lead && <Lead>{lead}</Lead>}
      </Head>
      {children}
    </Section>
  )
}

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space[5]};
  min-width: 0;
`

const Head = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
`

const TitleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space[2]} ${space[5]};
`

const Title = styled.h3`
  margin: 0;
  scroll-margin-top: ${space[8]};
  ${type.h3}
  ${onField}
`

const Lead = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  ${onField}
`
