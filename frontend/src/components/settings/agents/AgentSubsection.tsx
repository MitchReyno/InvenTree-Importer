import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import type { AgentSubsectionId } from '#/navigation/app-route'

type AgentSubsectionProps = {
  id: AgentSubsectionId
  title: string
  /** One line under the heading; leave it out when the title says enough. */
  lead?: string
  children: ReactNode
}

/** The heading id a sub-nav link scrolls to and focuses. */
export function subsectionHeadingId(id: AgentSubsectionId) {
  return `agents-${id}`
}

/** One Settings › Agents subsection: its heading renders at once, before the settings load. */
export function AgentSubsection({ id, title, lead, children }: AgentSubsectionProps) {
  const headingId = subsectionHeadingId(id)

  return (
    <Section aria-labelledby={headingId}>
      <Head>
        <Title id={headingId} tabIndex={-1}>
          {title}
        </Title>
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
  scroll-margin-top: ${space[8]};
`

const Title = styled.h3`
  margin: 0;
  ${type.h3}
`

const Lead = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
