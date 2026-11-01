import { HeadingRow } from '../ui/primitives'
import { Button, Heading, Panel, Paragraph, Small } from '../ui/primitives'
import type { Snapshot } from '../../capture/types'
import { display } from '../../capture/display'
import styled, { css } from 'styled-components'

type Props = {batch: Snapshot; selected: string; dirty: boolean; frozen: boolean; setSelected: (value: string) => void}
export function CaptureQueue({batch,selected,dirty,frozen,setSelected}: Props) {
 return (      <QueueArea data-area="queue"  aria-label="Capture selection">
      <Panel><HeadingRow ><Heading>Physical lots <Small>{batch.lots.length} retained</Small></Heading><Button disabled={dirty || frozen} onClick={() => setSelected('add_lot')}>Add lot</Button></HeadingRow><QueueList data-lots>{batch.lots.map((l, i) => <li key={l.id}><Button aria-label={`Edit lot ${l.label}`} disabled={dirty} aria-pressed={selected === l.id} onClick={() => setSelected(l.id)}><strong>#{i + 1} · {l.label}</strong><Small>{display(l.quantity, batch, 'quantity')}</Small><Small>{l.location.mode === 'inherit' ? '' : 'Override · '}{display(l.location, batch, 'location')}</Small></Button></li>)}</QueueList>{!batch.lots.length && <Paragraph>Add each packet separately. A shared Part never combines physical lots.</Paragraph>}</Panel>
      <Panel><HeadingRow ><Heading>Part proposals</Heading><Button disabled={dirty || frozen} onClick={() => setSelected('add_part')}>Add Part</Button></HeadingRow><QueueList >{batch.parts.map(p => <li key={p.id}><Button aria-label={`Edit Part ${p.label}`} disabled={dirty} aria-pressed={selected === p.id} onClick={() => setSelected(p.id)}>{p.label}<Small>Shared by {batch.lots.filter(l => l.part_subject_id === p.id).length} distinct lots</Small></Button></li>)}</QueueList>{!batch.parts.length && <Paragraph>No Part proposals yet.</Paragraph>}</Panel>
      <Panel><Heading>Shared details</Heading><QueueActions data-queue-actions="true" ><Button disabled={dirty} aria-pressed={selected === 'defaults'} onClick={() => setSelected('defaults')}>Batch defaults</Button><Button disabled={dirty || frozen} aria-pressed={selected === 'batch'} onClick={() => setSelected('batch')}>Batch title</Button><Button disabled={dirty || frozen} onClick={() => setSelected('note')}>Write a human note</Button></QueueActions></Panel>
    </QueueArea>
 )
}

const QueueArea = styled.aside`
  grid-area: queue; min-width: 0;
  @media(max-width:700px) {
    display: flex; flex-direction: column;
    section { padding: 10px; }
    section:not(:first-child) { margin-bottom: 8px; }
    section:not(:first-child) ul, section:not(:first-child) [data-queue-actions] { display: flex; gap: 6px; flex-wrap: wrap; }
    section:not(:first-child) li { flex: 1; min-width: 130px; }
    section:not(:first-child) button { width: auto; flex: 1; margin: 0; }
  }
`
const queueStyles = css`
  list-style: none; padding: 0; margin: 8px 0 0;
  button { display: block; width: 100%; text-align: left; margin: 6px 0; overflow-wrap: anywhere; color: #233349; background: #f7f9fc; border: 1px solid #d5dce5; }
  button[aria-pressed='true'] { border-color: #266ac5; background: #dae9ff; box-shadow: inset 3px 0 #266ac5; }
  strong { display: block; margin-bottom: 4px; }
`
const QueueList = styled.ul`
  ${queueStyles}
  @media(max-width:700px) { &[data-lots] { display: grid; gap: 2px; button { margin: 4px 0; } } }
`
const QueueActions = styled.div`${queueStyles}`
