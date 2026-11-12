import styled from 'styled-components'
import type { agentsClient } from '@invimport/contracts/client'
import { Banner, SettingsNav, type SettingsSection } from '#/components/ui'
import { space } from '#/theme/generated/tokens'
import { routeBatchId, type SettingsSectionId } from '#/navigation/app-route'
import { settingsBack } from '#/navigation/settings-return'
import { useCachedBatchReads } from '#/header/useCachedBatchReads'
import { AgentsSection } from './AgentsSection'
import { AppearanceSection } from './AppearanceSection'
import { BatchDefaultsSection } from './BatchDefaultsSection'
import { DescriptionsSection } from './DescriptionsSection'
import { InvenTreeSection } from './InvenTreeSection'

type Props = {
  section: SettingsSectionId
  /** The route Settings was opened from; none for a direct load. */
  returnTo: string | undefined
  /** Absent where this setup has no agent settings. */
  agents: ReturnType<typeof agentsClient> | null
  onDirtyChange: (dirty: boolean) => void
}

const SECTIONS: SettingsSection[] = [
  { id: 'agents', label: 'Agents', href: '#settings/agents', agent: true },
  { id: 'inventree', label: 'InvenTree', href: '#settings/inventree' },
  { id: 'defaults', label: 'Batch defaults', href: '#settings/defaults' },
  { id: 'descriptions', label: 'Descriptions and naming', href: '#settings/descriptions' },
  { id: 'appearance', label: 'Appearance', href: '#settings/appearance' },
]

/** The Settings page: a back link and section nav beside the open section. */
export function Settings({ section, returnTo, agents, onDirtyChange }: Props) {
  // The batch screen's own read names the batch; Settings never reads it again.
  const { title } = useCachedBatchReads(routeBatchId(returnTo))

  return (
    <Layout>
      <NavColumn>
        <SettingsNav
          back={settingsBack(returnTo, title)}
          sections={SECTIONS}
          current={section}
          headingLevel="h1"
        />
      </NavColumn>
      <Content>
        <SectionContent section={section} agents={agents} onDirtyChange={onDirtyChange} />
      </Content>
    </Layout>
  )
}

function SectionContent({ section, agents, onDirtyChange }: Omit<Props, 'returnTo'>) {
  switch (section) {
    case 'agents':
      return agents ? (
        <AgentsSection client={agents} onDirtyChange={onDirtyChange} />
      ) : (
        <div role="status">
          <Banner tone="info">Agent settings are unavailable for this setup.</Banner>
        </div>
      )
    case 'inventree':
      return <InvenTreeSection />
    case 'defaults':
      return <BatchDefaultsSection />
    case 'descriptions':
      return <DescriptionsSection />
    case 'appearance':
      return <AppearanceSection />
  }
}

const Layout = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: ${space[12]};
`

const NavColumn = styled.div`
  flex: 1 1 200px;
  max-width: 240px;
`

const Content = styled.div`
  flex: 999 1 560px;
  min-width: 0;
`
