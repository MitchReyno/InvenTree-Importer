import styled from 'styled-components'
import type { agentsClient } from '@invimport/contracts/client'
import { Banner, SettingsNav, media, type SettingsSection } from '#/components/ui'
import { space } from '#/theme/generated/tokens'
import {
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

type Props = {
  section: SettingsSectionId
  /** The Agents subsection the route points at, if any. */
  subsection?: AgentSubsectionId
  /** The route Settings was opened from; none for a direct load. */
  returnTo: string | undefined
  /** Absent where this setup has no agent settings. */
  agents: ReturnType<typeof agentsClient> | null
  onDirtyChange: (dirty: boolean) => void
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
export function Settings({ section, subsection, returnTo, agents, onDirtyChange }: Props) {
  // The batch screen's own read names the batch; Settings never reads it again.
  const { title } = useCachedBatchReads(routeBatchId(returnTo))

  return (
    <Layout>
      <NavColumn>
        <SettingsNav
          back={settingsBack(returnTo, title)}
          sections={SECTIONS}
          current={section}
          currentSubsection={subsection}
          headingLevel="h1"
        />
      </NavColumn>
      <Content>
        <SectionContent
          section={section}
          subsection={subsection}
          agents={agents}
          onDirtyChange={onDirtyChange}
        />
      </Content>
    </Layout>
  )
}

function SectionContent({ section, subsection, agents, onDirtyChange }: Omit<Props, 'returnTo'>) {
  switch (section) {
    case 'agents':
      return agents ? (
        <AgentsSection client={agents} onDirtyChange={onDirtyChange} subsection={subsection} />
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
