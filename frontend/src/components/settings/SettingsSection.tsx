import { useId, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import { AiMark } from '#/components/ui'

type Props = {
  title: string
  /** One line on what the section sets. */
  lead: string
  /** The section where a person meets the agents carries the AI mark. */
  agent?: boolean
  children: ReactNode
}

/** A Settings section: its heading and lead line, then its cards. */
export function SettingsSection({ title, lead, agent, children }: Props) {
  const titleId = useId()

  return (
    <Section aria-labelledby={titleId}>
      <Head>
        <Title id={titleId}>{agent ? <AiMark>{title}</AiMark> : title}</Title>
        <Lead>{lead}</Lead>
      </Head>
      {children}
    </Section>
  )
}

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space[8]};
  min-width: 0;
`

const Head = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
`

const Title = styled.h2`
  margin: 0;
  ${type.h2}
`

const Lead = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
