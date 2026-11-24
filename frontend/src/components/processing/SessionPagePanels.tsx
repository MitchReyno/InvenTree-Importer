import styled from 'styled-components'
import type { SessionHistoryEntryDto } from '@invimport/contracts'
import { Small } from '#/components/ui'
import { citedSources, viewedPhotos } from '#/processing/session-history'
import { color, radius, space, type } from '#/theme/generated/tokens'
import { HistoryLink, type HistoryContext } from './HistoryLink'

const NOT_LOADED = 'Older entries are not loaded yet, so earlier ones may be missing.'

/**
 * The photos the session was sent and the sources it cited, from the entries loaded so far,
 * saying so while older entries remain to load.
 */
export function SessionPagePanels({
  entries,
  olderRemain,
  context,
}: {
  entries: readonly SessionHistoryEntryDto[]
  olderRemain: boolean
  context: HistoryContext
}) {
  const photos = viewedPhotos(entries)
  const sources = citedSources(entries)
  return (
    <>
      <Panel aria-label="Sources it cited">
        <h3>Sources it cited</h3>
        {olderRemain && <Small>{NOT_LOADED}</Small>}
        {sources.length === 0 ? (
          <Small>None in the loaded entries.</Small>
        ) : (
          <ul>
            {sources.map((source) => (
              <li key={JSON.stringify(source.link)}>
                <HistoryLink link={source.link} context={context} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel aria-label="Photos it viewed">
        <h3>Photos it viewed</h3>
        {olderRemain && <Small>{NOT_LOADED}</Small>}
        {photos.length === 0 ? (
          <Small>None in the loaded entries.</Small>
        ) : (
          <ul>
            {photos.map((photo) => (
              <li key={JSON.stringify(photo.link)}>
                <span>{photo.label}</span>{' '}
                <Small>
                  · {photo.views} {photo.views === 1 ? 'view' : 'views'}
                </Small>{' '}
                <HistoryLink link={photo.link} context={context} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}

const Panel = styled.section`
  display: grid;
  gap: ${space[3]};
  padding: ${space[5]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  min-width: 0;
  overflow-wrap: anywhere;
  h3 {
    ${type.h3}
    margin: 0;
  }
  ul {
    margin: 0;
    padding-left: ${space[5]};
    display: grid;
    gap: ${space[2]};
  }
`
