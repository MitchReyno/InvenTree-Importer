import { StrictMode, useState } from 'react'
import styled from 'styled-components'
import { GlobalStyle } from '#/components/GlobalStyle'
import { EvidenceDragContext } from '#/components/media/EvidenceDragContext'
import { EvidenceDragHandle } from '#/components/media/EvidenceDragHandle'
import { useEvidenceDropZone } from '#/components/media/EvidenceDropZone'
import { EvidenceGroup } from '#/components/ui'

export function EvidenceDragProof() {
  const [group, setGroup] = useState<string | null>(null)
  const [moves, setMoves] = useState(0)
  return (
    <StrictMode>
      <GlobalStyle />
      <Main>
        <h1>Evidence movement qualification</h1>
        <p>Owned fixture · React19.3.1 · no API, inventory or provider clients.</p>
        <label>
          Fixture draft
          <input aria-label="Fixture draft" />
        </label>
        <p role="status">Confirmed fixture moves: {moves}</p>
        <EvidenceDragContext
          disabled={false}
          onMove={async (_id, destination) => {
            if (group === destination) {
              return 'unchanged'
            }
            setGroup(destination)
            setMoves((value) => value + 1)
            return 'saved'
          }}
        >
          <Zones>
            {[null, 'packet-a', 'packet-b'].map((id) => (
              <Zone key={id ?? 'ungrouped'} id={id} hasFile={group === id} />
            ))}
          </Zones>
        </EvidenceDragContext>
      </Main>
    </StrictMode>
  )
}

function Zone({ id, hasFile }: { id: string | null; hasFile: boolean }) {
  const name = id ?? 'Ungrouped'
  const drop = useEvidenceDropZone(id, name, false)
  return (
    <EvidenceGroup
      ref={drop.ref}
      dropState={drop.dropState}
      name={name}
      count={hasFile ? 1 : 0}
      ungrouped={id === null}
    >
      {hasFile && (
        <EvidenceDragHandle
          evidenceId="synthetic-original"
          label="Synthetic original"
          disabled={false}
        >
          {(handle) => <p>{handle} Synthetic original · unchanged identity</p>}
        </EvidenceDragHandle>
      )}
    </EvidenceGroup>
  )
}

const Main = styled.main`
  max-width: 1100px;
  padding: 16px;
  margin: auto;
  input {
    max-width: 100%;
    min-height: 44px;
  }
`
const Zones = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
  @media (max-width: 700px) {
    grid-template-columns: minmax(0, 1fr);
  }
`
