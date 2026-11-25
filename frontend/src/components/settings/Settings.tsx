import { useEffect, type MouseEvent } from 'react'
import styled from 'styled-components'
import type { agentsClient } from '@invimport/contracts/client'
import { Banner, SettingsNav, media, useMediaQuery, type SettingsSection } from '#/components/ui'
import { space } from '#/theme/generated/tokens'
import {
  AGENT_SUBSECTIONS,
  routeBatchId,
  type AgentSubsectionId,
  type SettingsSectionId,
} from '#/navigation/app-route'
import { settingsBack } from '#/navigation/settings-return'
import { useCachedBatchReads } from '#/header/useCachedBatchReads'
import { AgentsSection } from './AgentsSection'
import { AppearanceSection } from './AppearanceSection'
import { BatchDefaultsSection } from './BatchDefaultsSection'
import { DeveloperSection } from './DeveloperSection'
import { InvenTreeSection } from './InvenTreeSection'
import { scrollToSubsection } from './agents/AgentSubsection'
import { useSubsectionInView } from './agents/useSubsectionInView'

type Props = {
  section: SettingsSectionId
  /** The Agents subsection the route points at, if any. */
  subsection?: AgentSubsectionId
  /** Whether that route was written by scrolling, so the page is already there. */
  routeFromScroll?: boolean
  /** Replaces the current history entry's route with the Agents subsection scrolled to. */
  replaceSubsection: (route: string) => void
  /** The route Settings was opened from; none for a direct load. */
  returnTo: string | undefined
  /** Absent where this setup has no agent settings. */
  agents: ReturnType<typeof agentsClient> | null
  /** Reports unsaved input, with how to save what can be saved before leaving. */
  onDirtyChange: (dirty: boolean, beforeLeave?: () => Promise<boolean>) => void
}

const SECTIONS: SettingsSection[] = [
  {
    id: 'agents',
    label: 'Agents',
    href: '#settings/agents',
    agent: true,
    subsections: [
      { id: 'providers', label: 'Providers', href: '#settings/agents/providers' },
      { id: 'sessions', label: 'Sessions', href: '#settings/agents/sessions' },
      { id: 'models', label: 'Provider and model per step', href: '#settings/agents/models' },
      { id: 'instructions', label: 'Instructions', href: '#settings/agents/instructions' },
      {
        id: 'descriptions',
        label: 'Descriptions and naming',
        href: '#settings/agents/descriptions',
      },
      { id: 'tags', label: 'Tag suggestions', href: '#settings/agents/tags' },
      { id: 'research', label: 'Web research', href: '#settings/agents/research' },
    ],
  },
  { id: 'inventree', label: 'InvenTree', href: '#settings/inventree' },
  { id: 'defaults', label: 'Batch defaults', href: '#settings/defaults' },
  { id: 'appearance', label: 'Appearance', href: '#settings/appearance' },
  { id: 'developer', label: 'Developer', href: '#settings/developer' },
]

/** The Settings page: a back link and section nav beside the open section. */
export function Settings({
  section,
  subsection,
  routeFromScroll = false,
  replaceSubsection,
  returnTo,
  agents,
  onDirtyChange,
}: Props) {
  // The batch screen's own read names the batch; Settings never reads it again.
  const { title } = useCachedBatchReads(routeBatchId(returnTo))
  // Stacked, the nav isn't in view while the content scrolls, so the route alone decides.
  const stacked = useMediaQuery(media.stacked)
  const { inView, pause } = useSubsectionInView(
    AGENT_SUBSECTIONS,
    section === 'agents' && agents !== null && !stacked,
  )
  const currentSubsection = inView ?? subsection

  // Syncs the address with the subsection scrolled to, replacing the entry rather than adding one.
  useEffect(() => {
    if (inView && inView !== subsection) {
      replaceSubsection(`settings/agents/${inView}`)
    }
  }, [inView, subsection, replaceSubsection])

  /** A link to the subsection the address already names changes no hash, so it scrolls here. */
  function handleSubsectionClick(id: string, event: MouseEvent<HTMLAnchorElement>) {
    const modified =
      event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    if (section !== 'agents' || id !== subsection || modified) {
      return
    }
    pause()
    scrollToSubsection(subsection)
  }

  return (
    <Layout>
      <NavColumn>
        <SettingsNav
          back={settingsBack(returnTo, title)}
          sections={SECTIONS}
          current={section}
          currentSubsection={currentSubsection}
          headingLevel="h1"
          onSubsectionClick={handleSubsectionClick}
        />
      </NavColumn>
      <Content>
        <SectionContent
          section={section}
          subsection={subsection}
          routeFromScroll={routeFromScroll}
          beforeScroll={pause}
          agents={agents}
          onDirtyChange={onDirtyChange}
        />
      </Content>
    </Layout>
  )
}

function SectionContent({
  section,
  subsection,
  routeFromScroll,
  beforeScroll,
  agents,
  onDirtyChange,
}: Omit<Props, 'returnTo' | 'replaceSubsection'> & { beforeScroll: () => void }) {
  switch (section) {
    case 'agents':
      return agents ? (
        <AgentsSection
          client={agents}
          onDirtyChange={onDirtyChange}
          subsection={subsection}
          routeFromScroll={routeFromScroll}
          beforeScroll={beforeScroll}
        />
      ) : (
        <div role="status">
          <Banner tone="info">Agent settings are unavailable for this setup.</Banner>
        </div>
      )
    case 'inventree':
      return <InvenTreeSection onDirtyChange={onDirtyChange} />
    case 'defaults':
      return <BatchDefaultsSection onDirtyChange={onDirtyChange} />
    case 'appearance':
      return <AppearanceSection />
    case 'developer':
      return <DeveloperSection />
  }
}

const Layout = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  /* Stacked, the nav and content are page sections and take the page gap. */
  gap: ${space[7]} ${space[12]};
`

const NavColumn = styled.div`
  flex: 1 1 200px;
  max-width: 240px;
  /* Beside the content the nav stays in view, so a subsection link never scrolls its siblings away. */
  position: sticky;
  top: ${space[8]};
  ${media.stacked} {
    position: static;
  }
`

const Content = styled.div`
  flex: 999 1 560px;
  min-width: 0;
`
