import { useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, space, type } from '../../../theme/generated/tokens'
import { GlobalStyle } from '../../GlobalStyle'
import { EvidenceActions } from '../../media/EvidenceActions'
import { Masthead } from '../../masthead/Masthead'
import { AutosaveStatus, type AutosaveState } from '../AutosaveStatus'
import { AutoValueField, type AutoValue } from '../AutoValueField'
import { Banner } from '../Banner'
import { BulkBar } from '../BulkBar'
import { Button } from '../Button'
import { ChangeSummary } from '../ChangeSummary'
import { DataTable } from '../DataTable'
import { Dialog } from '../Dialog'
import { DisabledFeature } from '../DisabledFeature'
import { EvidenceGroup } from '../EvidenceGroup'
import { EvidenceGrid, EvidenceTile } from '../EvidenceTile'
import { FilterChips } from '../FilterChips'
import { KeyValue } from '../KeyValue'
import { Kbd } from '../Kbd'
import { NeedsYou } from '../NeedsYou'
import { OptionRow } from '../OptionRow'
import { PhaseRow } from '../PhaseRow'
import { Popover } from '../Popover'
import { Count, Pill, type PillTone } from '../Pill'
import { ProblemList } from '../ProblemCard'
import { ProgressSegments, Skeleton, Spinner } from '../Progress'
import { QuestionCard } from '../QuestionCard'
import { RecordChain } from '../RecordChain'
import { SegmentedControl } from '../SegmentedControl'
import { SessionChat } from '../SessionChat'
import { SharedTagsInput, type SharedTags } from '../SharedTagsInput'
import { SourceChip } from '../SourceChip'
import { StatusTimeline } from '../StatusTimeline'
import { StickyFooter } from '../StickyFooter'
import { SubTabs, Tabs } from '../Tabs'
import { Toast } from '../Toast'
import { Input, Label, Notice, Panel } from '../primitives'

// A blank white page, the hardest ground for a focus ring on a preview.
const WHITE_PREVIEW =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='400' height='300' fill='white'/%3E%3C/svg%3E"

/** Owned browser fixture: every design-system component with synthetic data, no API. */
export function ComponentGallery() {
  const [view, setView] = useState('workspace')
  const [filter, setFilter] = useState('all')
  const [phaseOpen, setPhaseOpen] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [answer, setAnswer] = useState<string | undefined>()
  const [auto, setAuto] = useState<AutoValue>({ mode: 'auto' })
  const [tags, setTags] = useState<SharedTags>({ manual: ['bench bag', 'SMD'], auto: true })
  const tones: PillTone[] = ['ok', 'warn', 'bad', 'info', 'acc', 'neutral', 'outline']
  const saveStates: AutosaveState[] = ['saved', 'saving', 'invalid', 'conflict', 'unconfirmed']

  return (
    <>
      <GlobalStyle />
      <Masthead
        breadcrumb={[{ label: 'Batches', href: '#' }, { label: 'Component gallery' }]}
        status={<Pill tone="acc">Fixture only</Pill>}
      />
      <Page>
        <Banner tone="info" action={<Button size="sm">Open</Button>}>
          Synthetic content for the component gallery. Nothing here reads or writes data.
        </Banner>

        <Section title="Actions">
          <EvidenceActions
            mediaDisabled={false}
            noteDisabled={false}
            takePhotos={() => {}}
            addDocument={() => {}}
            writeNote={() => {}}
          />
          <Row>
            <Button variant="primary" icon="+">
              Add evidence
            </Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="warn">Warn</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Small</Button>
            <Button size="lg" variant="primary">
              Approve 6 items and add to InvenTree
            </Button>
            <Button busy>Saving</Button>
            <Button disabledReason="Answer the open question first">Approve 3</Button>
            <span>
              Press <Kbd>J</Kbd> for next
            </span>
          </Row>
          <Row>
            <Popover label="Needs you" align="start" trigger={<Button>2 need you</Button>}>
              <p>Is the loose bag 1N4148 diodes?</p>
            </Popover>
            <Button onClick={() => setDialogOpen(true)}>Merge lots…</Button>
            {dialogOpen && (
              <Dialog title="Merge 2 lots" onClose={() => setDialogOpen(false)}>
                <p>10 kΩ resistor packets A and B become one lot of 880. Their evidence stays linked.</p>
              </Dialog>
            )}
          </Row>
        </Section>

        <Section title="Status">
          <Row>
            {tones.map((tone) => (
              <Pill key={tone} tone={tone}>
                {tone}
              </Pill>
            ))}
            <Count value={0} />
            <Count value={8} tone="warn" />
            <Count value={12} tone="ok" />
            <Count value={1200} tone="bad" />
          </Row>
          <Row>
            <SourceChip source="Packet label" certainty="Label and slip agree" onOpen={() => {}} />
            <SourceChip source="Agent" certainty="Likely — check" tone="likely" onOpen={() => {}} />
            <SourceChip
              source="Photo 3"
              certainty="Sources disagree"
              tone="conflict"
              onOpen={() => {}}
            />
            <SourceChip source="You" certainty="Entered" tone="user" onOpen={() => {}} />
          </Row>
          <Stack>
            <Banner tone="warn">2 questions need an answer before approval.</Banner>
            <Banner tone="bad">The last run failed. Retry from Added.</Banner>
            <Banner tone="ok">All 6 items were added.</Banner>
            <Banner tone="plain">Processing runs in the background.</Banner>
          </Stack>
          <ProblemList
            problems={[
              {
                id: 'w',
                severity: 'warning',
                title: 'Low certainty',
                summary: '1 lot',
                issues: [{ title: 'Caps', text: 'The value is read from a blurred label.' }],
              },
              {
                id: 'b',
                severity: 'blocking',
                title: 'Part not chosen',
                summary: '2 lots',
                issues: [
                  {
                    title: 'Resistor bag',
                    text: 'Two Parts match the label.',
                    actions: <Button size="sm">Choose Part</Button>,
                  },
                ],
              },
            ]}
          />
          <Row>
            <Spinner />
            <ProgressSegments
              steps={[
                { label: 'Examine', state: 'done' },
                { label: 'Research', state: 'running', fraction: 0.4 },
                { label: 'Images', state: 'waiting' },
              ]}
            />
            <Skeleton width="120px" height="16px" />
          </Row>
          <ProgressSegments
            size="lg"
            steps={[
              { label: 'Examine', state: 'done' },
              { label: 'Research', state: 'running' },
              { label: 'Images', state: 'waiting' },
              { label: 'Inventory', state: 'waiting' },
            ]}
          />
        </Section>

        <Section title="Navigation">
          <Tabs
            label="Batch"
            current="review"
            items={[
              { id: 'capture', label: 'Capture', href: '#capture' },
              { id: 'processing', label: 'Processing', href: '#processing', count: 3 },
              {
                id: 'review',
                label: 'Review',
                href: '#review',
                count: 8,
                countLabel: 'to check',
                badge: { label: '3 to decide', tone: 'warn' },
              },
              { id: 'changes', label: 'Changes', href: '#changes', disabled: true },
            ]}
          />
          <SubTabs
            label="Review views"
            current="lots"
            items={[
              { id: 'lots', label: 'Lots', href: '#lots', count: 12 },
              { id: 'map', label: 'Map', href: '#map' },
              { id: 'records', label: 'Records', href: '#records', spinner: true },
            ]}
          />
          <Row>
            <SegmentedControl
              label="View"
              value={view}
              onChange={setView}
              options={[
                { id: 'workspace', label: 'Workspace' },
                { id: 'table', label: 'Table' },
              ]}
            />
            <FilterChips
              label="Filter lots"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: 'All', count: 12 },
                { id: 'blocked', label: 'Blocked', count: 2 },
                { id: 'done', label: 'Done', count: 0 },
              ]}
            />
          </Row>
        </Section>

        <Section title="Evidence">
          <EvidenceGroup name="Packet front and back" count={3} onRename={() => {}}>
            <EvidenceGrid>
              <EvidenceTile
                name="IMG_2041.jpg"
                preview={WHITE_PREVIEW}
                support="1 lot"
                kind="photo"
                state="ready"
                selectable
                selected
                onOpen={() => {}}
              />
              <EvidenceTile name="IMG_2042.jpg" kind="photo" state="preparing" onOpen={() => {}} />
              <EvidenceTile
                name="slip.pdf"
                support="2 lots"
                kind="document"
                state="failed"
                onOpen={() => {}}
                onRetry={() => {}}
              />
            </EvidenceGrid>
          </EvidenceGroup>
          <EvidenceGroup name="Not grouped yet" count={0} ungrouped dropState="over" />
        </Section>

        <Section title="Records and tables">
          <KeyValue
            rows={[
              {
                label: 'MPN',
                value: 'RC0603FR-0710KL',
                state: 'edited',
                mono: true,
                onEdit: () => {},
              },
              { label: 'Location', value: 'Drawer 4', state: 'override' },
              {
                label: 'Supplier',
                value: 'Mouser',
                state: 'inherited',
                source: <SourceChip source="Slip" certainty="Read" onOpen={() => {}} />,
              },
            ]}
          />
          <RecordChain
            links={[
              { kind: 'Manufacturer', label: 'Yageo', state: 'exists', href: '#m' },
              { kind: 'Part', label: 'RC0603FR-0710KL', state: 'new', href: '#p' },
              { kind: 'Supplier part', label: 'Mouser 603-RC0603FR', state: 'choose', href: '#s' },
              { kind: 'Stock', label: '100 pcs', state: 'update', href: '#t' },
            ]}
          />
          <BulkBar count={2} field="Location" onApply={() => {}} onClear={() => {}} />
          <DataTable
            caption="Lots"
            columns={[
              { id: 'name', header: 'Lot' },
              { id: 'mpn', header: 'MPN', mono: true, editable: true },
              { id: 'qty', header: 'Quantity', editable: true },
            ]}
            rows={[
              {
                id: 'l1',
                label: 'Resistor bag',
                cells: {
                  name: { value: 'Resistor bag' },
                  mpn: { value: 'RC0603FR-0710KL', edited: true },
                  qty: { value: '100', override: true },
                },
              },
              {
                id: 'l2',
                label: 'Caps',
                cells: {
                  name: { value: 'Caps' },
                  mpn: { value: 'GRM188R71H104KA93D' },
                  qty: { value: '50' },
                },
              },
            ]}
            selection={{ selected: new Set(['l1']), onToggle: () => {}, onToggleAll: () => {} }}
            onCellEdit={() => {}}
          />
          <Card>
            <ChangeSummary
              sections={[
                {
                  title: 'New Parts',
                  count: 2,
                  items: [
                    {
                      id: 'p1',
                      label: 'RC0603FR-0710KL',
                      href: '#p1',
                      pill: <Pill tone="info">New</Pill>,
                    },
                    { id: 'p2', label: 'GRM188R71H104KA93D' },
                  ],
                },
                {
                  title: 'Stock',
                  count: 1,
                  items: [
                    {
                      id: 's1',
                      label: '100 pcs into Drawer 4',
                      pill: <Pill tone="ok">Ready</Pill>,
                    },
                  ],
                },
              ]}
            />
          </Card>
        </Section>

        <Section title="Processing and agents">
          <Card>
            <PhaseRow
              state="done"
              title="Examine"
              outcome="6 photos read, 4 lots formed"
              expanded={false}
              onToggle={() => {}}
            />
            <PhaseRow
              state="running"
              title="Research"
              outcome="4 of 9 lots researched"
              badges={<Pill tone="warn">1 question</Pill>}
              expanded={phaseOpen}
              onToggle={() => setPhaseOpen((open) => !open)}
            >
              <StatusTimeline
                label="Research session"
                entries={[
                  { text: 'Read the datasheet for RC0603', time: '10:02' },
                  { text: 'Checking the reel label', time: '10:04', current: true },
                ]}
              />
            </PhaseRow>
            <PhaseRow
              state="waiting"
              title="Images"
              outcome="Waits for Research"
              expanded={false}
              onToggle={() => {}}
            />
          </Card>
          <QuestionCard
            question="Is this 10kΩ or 100kΩ?"
            why="The label and the reel disagree."
            assumption="Using 10kΩ from the label until you answer."
            answer={
              <OptionRow
                name="value"
                value={answer}
                onChange={setAnswer}
                options={[
                  { id: '10k', title: '10kΩ', detail: 'Matches the label' },
                  { id: '100k', title: '100kΩ', detail: 'Matches the reel' },
                ]}
                escape={{
                  id: 'unsure',
                  title: 'Not sure',
                  detail: 'Keep the assumption and flag the lot',
                }}
              />
            }
          />
          <Card>
            <NeedsYou
              items={[
                {
                  id: 'q1',
                  title: 'Resistor value',
                  assumption: 'Assuming 10kΩ',
                  step: 'Research',
                  href: '#q1',
                },
                {
                  id: 'q2',
                  title: 'Supplier for bench bag',
                  assumption: 'Assuming Mouser',
                  href: '#q2',
                },
              ]}
            />
          </Card>
          <SessionChat
            messages={[
              { id: 'm1', who: 'Examine', text: 'Is the blue reel part of lot 2?', mine: false },
              { id: 'm2', who: 'You', text: 'Yes, same packet.', mine: true },
            ]}
            onSend={() => {}}
          />
        </Section>

        <Section title="Forms and existing controls">
          <Grid>
            <Label>
              Title
              <Input defaultValue="Mouser 3381-22 + bench bag" />
            </Label>
            <AutoValueField label="Purchase date" type="date" value={auto} onChange={setAuto} />
          </Grid>
          <SharedTagsInput value={tags} onChange={setTags} />
          <Row>
            <DisabledFeature
              label="Find logo automatically"
              explanation="Coming later. Upload a logo for now."
            />
          </Row>
          <Stack>
            {saveStates.map((state) => (
              <AutosaveStatus
                key={state}
                label="Batch settings"
                state={state}
                revision="12"
                onRetry={() => {}}
                onReload={() => {}}
              />
            ))}
          </Stack>
          <Notice>Notice primitive on its token ground.</Notice>
        </Section>

        <StickyFooter
          label="Ready to add"
          summary="6 items ready · test InvenTree"
          primary={
            <Button variant="primary" size="lg">
              Add 6 items
            </Button>
          }
        />
        <Toast
          message="Lot moved to Drawer 4"
          durationMs={600_000}
          action={{ label: 'Undo', onClick: () => {} }}
          onDismiss={() => {}}
        />
      </Page>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel>
      <Heading>{title}</Heading>
      <Stack>{children}</Stack>
    </Panel>
  )
}

const Page = styled.main`
  display: flex;
  flex-direction: column;
  gap: ${space[9]};
  max-width: 1240px;
  margin: 0 auto;
  padding: ${space[9]} ${space[8]} ${space[20]};
`

const Heading = styled.h2`
  margin: 0 0 ${space[6]};
  ${type.h2}
`

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[6]};
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: ${space[6]};
`

const Card = styled.div`
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`
