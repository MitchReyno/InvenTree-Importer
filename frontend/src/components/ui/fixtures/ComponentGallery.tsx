import { useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, space, type } from '#/theme/generated/tokens'
import { GlobalStyle } from '#/components/GlobalStyle'
import { CaptureActions } from '#/components/capture/CaptureActions'
import { Masthead } from '#/components/masthead/Masthead'
import { AiMark } from '#/components/ui/AiMark'
import { AutosaveStatus, type AutosaveState } from '#/components/ui/AutosaveStatus'
import { AutoValueField, type AutoValue } from '#/forms/AutoValueField'
import { Banner } from '#/components/ui/Banner'
import { BulkBar } from '#/components/ui/BulkBar'
import { Button } from '#/components/ui/Button'
import { ChangeSummary } from '#/components/ui/ChangeSummary'
import { CompareTable } from '#/components/ui/CompareTable'
import { DataTable } from '#/components/ui/DataTable'
import { DESCRIPTION_LIMIT, DescriptionField } from '#/components/ui/DescriptionField'
import { Dialog } from '#/components/ui/Dialog'
import { DisabledFeature } from '#/components/ui/DisabledFeature'
import { EvidenceGroup } from '#/components/ui/EvidenceGroup'
import { EvidenceGrid, EvidenceTile } from '#/components/ui/EvidenceTile'
import { FilterChips } from '#/components/ui/FilterChips'
import { HelpButton } from '#/components/ui/HelpButton'
import { IconButton } from '#/components/ui/IconButton'
import { MenuIcon, SettingsIcon } from '#/components/ui/icons'
import { KeyValue } from '#/components/ui/KeyValue'
import { Kbd } from '#/components/ui/Kbd'
import { NeedsYou } from '#/components/ui/NeedsYou'
import { NumberStepper } from '#/components/ui/NumberStepper'
import { OptionRow } from '#/forms/OptionRow'
import { Popover } from '#/components/ui/Popover'
import { Count, Pill, type PillStatus, type PillTone } from '#/components/ui/Pill'
import { ProblemList } from '#/components/ui/ProblemCard'
import { ProgressSegments } from '#/components/ui/ProgressSegments'
import { Skeleton, Spinner } from '#/components/ui/Loading'
import { QuestionCard } from '#/components/ui/QuestionCard'
import { RecordChain } from '#/components/ui/RecordChain'
import { SegmentedControl } from '#/components/ui/SegmentedControl'
import { SessionChat } from '#/components/ui/SessionChat'
import { SettingRow } from '#/components/ui/SettingRow'
import { SettingsNav } from '#/components/ui/SettingsNav'
import { SharedTagsInput, type SharedTags } from '#/forms/SharedTagsInput'
import { SourceChip } from '#/components/ui/SourceChip'
import { StatusTimeline } from '#/components/ui/StatusTimeline'
import { StickyFooter } from '#/components/ui/StickyFooter'
import { Switch } from '#/components/ui/Switch'
import { SubTabs, Tabs } from '#/components/ui/Tabs'
import { TextField } from '#/forms/TextField'
import { Toast } from '#/components/ui/Toast'
import { TreeView } from '#/components/ui/TreeView'
import { Panel } from '#/components/ui/primitives'
import { Input, Label } from '#/forms/inputs'

// A blank white page, the hardest ground for a focus ring on a preview.
const WHITE_PREVIEW =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='400' height='300' fill='white'/%3E%3C/svg%3E"

/** Owned browser fixture: every design-system component with synthetic data, no API. */
const statuses: [PillStatus, string][] = [
  ['ready', 'Ready'],
  ['exists', 'Exists'],
  ['needs-answer', 'Needs answer'],
  ['warning', '1 warning'],
  ['duplicate', 'Possible duplicate'],
  ['blocking', '2 blocking'],
  ['failed', 'Failed'],
  ['new', 'New'],
  ['processing', 'Processing'],
  ['update', 'Update'],
  ['running', 'Running'],
  ['excluded', 'Excluded'],
  ['queued', 'Queued'],
  ['deferred', 'Deferred'],
  ['draft', 'Draft'],
  ['edited', 'Edited'],
]

export function ComponentGallery() {
  const [view, setView] = useState('workspace')
  const [filter, setFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [answer, setAnswer] = useState<string | undefined>()
  const [auto, setAuto] = useState<AutoValue>({ mode: 'auto' })
  const [tags, setTags] = useState<SharedTags>({ manual: ['bench bag', 'SMD'], auto: true })
  const [sessions, setSessions] = useState(3)
  const [webPages, setWebPages] = useState(true)
  const [description, setDescription] = useState(
    'Interconnect manufacturer: USB, board-to-board and card-edge connectors',
  )
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
          <CaptureActions
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
            <IconButton label="Settings" icon={<SettingsIcon />} href="#settings" />
            <IconButton label="Menu" icon={<MenuIcon />} />
            <span>Evidence</span>
            <HelpButton
              label="About groups"
              explanation="Group photos that belong together, such as the front and back of one packet. Groups are hints: one photo can still feed several lots."
            />
          </Row>
          <Row>
            <Popover label="Needs you" align="start" trigger={<Button>2 need you</Button>}>
              <p>Is the loose bag 1N4148 diodes?</p>
            </Popover>
            <Button onClick={() => setDialogOpen(true)}>Merge lots…</Button>
            {dialogOpen && (
              <Dialog title="Merge 2 lots" onClose={() => setDialogOpen(false)}>
                <p>
                  10 kΩ resistor packets A and B become one lot of 880. Their evidence stays linked.
                </p>
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
            {statuses.map(([status, word]) => (
              <Pill key={status} status={status}>
                {word}
              </Pill>
            ))}
          </Row>
          <Row>
            <SourceChip
              source="Packet label"
              certainty="Label and slip agree"
              field="Resistance"
              value="10 kΩ"
              why="Read “RES 10K 1%” from packet A’s label; packing slip line 1 says 10K too."
              evidence="Packet A · front, label crop. Also on: Packing slip 3381-22, line 1"
              onOpen={() => {}}
              onEdit={() => {}}
            />
            <SourceChip source="Datasheet" certainty="Matches datasheet" onOpen={() => {}} />
            <SourceChip
              source="Handwriting"
              certainty="Estimate"
              tone="likely"
              field="Quantity"
              value="200"
              why="Counted from the handwritten note on the bag."
              onOpen={() => {}}
            />
            <SourceChip
              source="Photo"
              certainty="Sources disagree"
              tone="conflict"
              onOpen={() => {}}
            />
            <SourceChip source="You" certainty="Your edit" tone="user" />
          </Row>
          <Row>
            <AiMark size="sm" />
            <AiMark />
            <AiMark size="lg" />
            <AiMark size="sm">Ask Inventory about this match</AiMark>
            <b>
              <AiMark>Agent sessions</AiMark>
            </b>
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
              {
                id: 'processing',
                label: 'Processing',
                href: '#processing',
                status: 'running',
                count: { value: '3', label: '3 questions', tone: 'warn' },
              },
              {
                id: 'review',
                label: 'Review',
                href: '#review',
                count: { value: '8', label: '8 to check', tone: 'default' },
              },
              { id: 'changes', label: 'Changes', href: '#changes', disabled: true },
            ]}
          />
          <SubTabs
            label="Review views"
            current="lots"
            items={[
              {
                id: 'lots',
                label: 'Lots',
                href: '#lots',
                count: { value: '12', label: '12 lots', tone: 'default' },
              },
              { id: 'map', label: 'Map', href: '#map' },
              {
                id: 'records',
                label: 'Records',
                href: '#records',
                count: { value: '3', label: '3 to decide', tone: 'warn' },
              },
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

        <Section title="Settings">
          <Grid>
            <SettingsNav
              back={{ label: 'Mouser 3381-22 › Processing', href: '#' }}
              current="agents"
              sections={[
                { id: 'agents', label: 'Agents', href: '#agents', agent: true },
                { id: 'inventree', label: 'InvenTree', href: '#inventree' },
                { id: 'defaults', label: 'Batch defaults', href: '#defaults' },
                { id: 'descriptions', label: 'Descriptions and naming', href: '#descriptions' },
                { id: 'appearance', label: 'Appearance', href: '#appearance' },
              ]}
            />
            <Card>
              <SettingRow
                label="Sessions at once"
                help="How many sessions may run turns together. Sessions waiting for you hold no slot."
              >
                <NumberStepper
                  label="Sessions at once"
                  value={sessions}
                  min={1}
                  max={8}
                  onChange={setSessions}
                />
              </SettingRow>
              <SettingRow label="Web research">
                <Switch label="Allow public web pages" checked={webPages} onChange={setWebPages} />
              </SettingRow>
              <SettingRow
                label="Model per step"
                disabledReason="Choosing a model for each step is not stored yet."
              >
                {({ named, disabled }) => (
                  <select defaultValue="default" {...named} {...disabled}>
                    <option value="default">Same as the default</option>
                  </select>
                )}
              </SettingRow>
            </Card>
          </Grid>
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
                source: (
                  <SourceChip source="Packing slip" certainty="Read from slip" onOpen={() => {}} />
                ),
              },
            ]}
          />
          <Grid>
            <DescriptionField
              label="Part description"
              value="Resistor 10 kΩ ±1% 0603 thick film"
              limit={DESCRIPTION_LIMIT.default}
              source={<SourceChip source="Datasheet" certainty="Matches datasheet" />}
            />
            <DescriptionField
              label="Company description"
              value={description}
              limit={DESCRIPTION_LIMIT.company}
              source={<SourceChip source="InvenTree" certainty="Existing" />}
              onChange={setDescription}
            />
            <DescriptionField
              label="Location type description"
              value={'Anti-static drawers on the bench, labelled by row and column. '.repeat(5)}
              limit={DESCRIPTION_LIMIT.default}
            />
            <DescriptionField
              label="Supplier part description"
              value={null}
              limit={DESCRIPTION_LIMIT.default}
              disabledReason="Supplier part descriptions are not stored yet."
            />
          </Grid>
          <TreeView
            label="What will change in InvenTree"
            nodes={[
              {
                id: 'cat',
                kind: 'Category',
                label: 'Passives › Resistors › SMD',
                status: <Pill status="exists">Exists</Pill>,
                children: [
                  {
                    id: 'part',
                    kind: 'Part',
                    label: 'RES-0144',
                    detail: 'Resistor 10 kΩ ±1% 0603 thick film',
                    status: <Pill status="new">New</Pill>,
                    children: [
                      {
                        id: 's1',
                        kind: 'Stock item',
                        label: '500',
                        detail: 'pcs · D/C 2341',
                        status: <Pill status="new">New</Pill>,
                      },
                      {
                        id: 's2',
                        kind: 'Stock item',
                        label: '380',
                        detail: 'pcs · D/C 2407',
                        status: <Pill tone="outline">Not ticked</Pill>,
                        dimmed: true,
                      },
                    ],
                  },
                ],
              },
            ]}
          />
          <CompareTable
            caption="This lot against existing stock"
            records={['This batch', 'Stock #1712']}
            rows={[
              { field: 'Part', values: ['OPA-0004 LM358DR', 'OPA-0004 LM358DR'] },
              { field: 'Date code', values: ['2338', '2338'] },
              { field: 'Location', values: ['Bench bin B3', 'Bench bin B3'] },
              { field: 'Quantity', values: ['5', '7'], differs: true },
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
            <StatusTimeline
              label="Research session"
              entries={[
                { text: 'Read the datasheet for RC0603', time: '10:02' },
                { text: 'Checking the reel label', time: '10:04', current: true },
              ]}
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
          <Row>
            <TextField label="Supplier order or receipt number" defaultValue="3381-22" />
            <TextField
              label="Quantity"
              placeholder="e.g. 500"
              error="Enter a whole number of parts."
            />
            <TextField
              label="Purchase order"
              defaultValue="Created automatically"
              help="Purchase orders aren't supported yet."
              disabled
            />
          </Row>
          <Grid>
            <Label>
              Title
              <Input defaultValue="Mouser 3381-22 + bench bag" />
            </Label>
            <AutoValueField label="Purchase date" type="date" value={auto} onChange={setAuto} />
          </Grid>
          <SharedTagsInput value={tags} onChange={setTags} />
          <Row>
            <DisabledFeature explanation="Coming later. Upload a logo for now.">
              {(disabled) => (
                <label>
                  <input type="checkbox" {...disabled} />
                  Find logo automatically
                </label>
              )}
            </DisabledFeature>
            <DisabledFeature explanation="Checking the connection on demand is not available yet.">
              {(disabled) => <Button {...disabled}>Check connection now</Button>}
            </DisabledFeature>
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
