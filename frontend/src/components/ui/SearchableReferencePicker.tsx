import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Select, {
  components,
  type InputActionMeta,
  type InputProps,
  type StylesConfig,
} from 'react-select'
import styled from 'styled-components'
import { color, radius, shadow } from '../../theme/generated/tokens'
import type { CatalogueCoverageDto, CatalogueRecordDto } from '@invimport/contracts'
import { rankReferences, type RankTier } from '../../capture/reference-rank'
import { Label, Small } from './primitives'

export type PickerSearch = (
  query: string,
  signal: AbortSignal,
) => Promise<{ results: readonly CatalogueRecordDto[]; exact: CatalogueRecordDto | null }>
export type PickerValue = { pk: string; label: string }

type Option =
  | { kind: 'record'; record: CatalogueRecordDto; tier: RankTier | 'detail' }
  | { kind: 'selected'; value: PickerValue }
  | { kind: 'create'; name: string }

type Props = {
  label: string
  /** Plural noun for coverage and empty-state text, e.g. `suppliers`. */
  noun?: string
  value: PickerValue | null
  candidates: readonly CatalogueRecordDto[]
  coverage: CatalogueCoverageDto | null
  status: 'loading' | 'ready' | 'unavailable'
  search: PickerSearch
  onChange: (record: CatalogueRecordDto) => void
  onCreate?: (name: string) => void
  createLabel?: string
  disabled?: boolean
  disabledReason?: string
}

const SEARCH_DEBOUNCE_MS = 250

function secondary(record: CatalogueRecordDto) {
  return record.kind === 'location' ? [record.path, record.description] : [record.description]
}

function optionLabel(option: Option) {
  if (option.kind === 'create') {
    return option.name
  }
  if (option.kind === 'selected') {
    return `${option.value.label} · #${option.value.pk}`
  }
  const { record } = option
  const path = record.kind === 'location' && record.path ? ` · ${record.path}` : ''
  return `${record.name} · #${record.pk}${path}${option.tier === 'detail' ? ' · Exact ID' : ''}`
}

const optionKey = (option: Option) =>
  option.kind === 'create'
    ? 'create'
    : option.kind === 'selected'
      ? `selected:${option.value.pk}`
      : `${option.record.kind}:${option.record.pk}`

/**
 * One searchable single selection for supplier, Default location and parent location. The
 * scored list is final: react-select's substring filter is disabled so typo matches survive.
 */
export function SearchableReferencePicker({
  label,
  noun = `${label.toLowerCase()}s`,
  value,
  candidates,
  coverage,
  status,
  search,
  onChange,
  onCreate,
  createLabel = 'New',
  disabled = false,
  disabledReason,
}: Props) {
  const id = useId()
  const [input, setInput] = useState('')
  const [remote, setRemote] = useState<{
    query: string
    results: readonly CatalogueRecordDto[]
    exact: CatalogueRecordDto | null
    failed: boolean
  } | null>(null)
  const [searching, setSearching] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    const query = input.trim()
    const mine = ++generation.current
    if (!query || status === 'unavailable') {
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(() => {
      search(query, controller.signal).then(
        (result) => {
          if (generation.current === mine) {
            setRemote({ query, ...result, failed: false })
            setSearching(false)
          }
        },
        () => {
          if (generation.current === mine) {
            setRemote({ query, results: [], exact: null, failed: true })
            setSearching(false)
          }
        },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [input, search, status])

  const options = useMemo<Option[]>(() => {
    const query = input.trim()
    const current = remote?.query === query ? remote : null
    const merged = new Map(candidates.map((record) => [record.pk, record]))
    for (const record of current?.results ?? []) {
      merged.set(record.pk, record)
    }
    const exact = current?.exact ?? null
    if (exact) {
      merged.delete(exact.pk)
    }
    const ranked = rankReferences(
      [...merged.values()].map((record) => ({ ...record, secondary: secondary(record) })),
      query,
    )
    const list: Option[] = [
      ...(exact ? [{ kind: 'record' as const, record: exact, tier: 'detail' as const }] : []),
      ...ranked.map(({ record, tier }) => ({
        kind: 'record' as const,
        record: merged.get(record.pk)!,
        tier,
      })),
    ]
    if (onCreate && query && !/^\d+$/.test(query)) {
      list.push({ kind: 'create', name: query })
    }
    return list
  }, [candidates, input, onCreate, remote])

  function onInputChange(next: string, meta: InputActionMeta) {
    if (meta.action === 'input-change') {
      setInput(next)
    } else if (
      meta.action === 'set-value' ||
      meta.action === 'input-blur' ||
      meta.action === 'menu-close'
    ) {
      setInput('')
    }
  }

  const searchFailed = remote?.failed === true && remote.query === input.trim()
  const describedBy = `${id}-status`
  const truncated = coverage?.truncated
    ? `Suggestions use ${coverage.loaded.toLocaleString('en')} of ${coverage.total.toLocaleString('en')} ${noun}. Refine the search or enter an exact ID.`
    : ''
  const statusText =
    status === 'unavailable'
      ? `${label} search unavailable. The current selection is kept; no empty catalogue is assumed.`
      : disabled && disabledReason
        ? disabledReason
        : searchFailed
          ? `${label} search unavailable for this query; suggestions use only the loaded ${noun}.`
          : truncated

  return (
    <Label as="div">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <Select<Option>
        inputId={id}
        components={pickerComponents}
        {...{ statusId: statusText ? describedBy : undefined }}
        options={options}
        value={value ? { kind: 'selected', value } : null}
        inputValue={input}
        onInputChange={onInputChange}
        onChange={(option) => {
          if (option?.kind === 'create') {
            onCreate?.(option.name)
          } else if (option?.kind === 'record') {
            onChange(option.record)
          }
        }}
        filterOption={null}
        getOptionLabel={(option) =>
          option.kind === 'create' ? `${createLabel} “${option.name}”` : optionLabel(option)
        }
        getOptionValue={optionKey}
        isDisabled={disabled}
        isLoading={status === 'loading' || searching}
        loadingMessage={() => `Searching ${noun}…`}
        noOptionsMessage={() =>
          status === 'unavailable'
            ? `${label} search unavailable`
            : searchFailed
              ? `${label} search unavailable; no matches in the loaded ${noun}`
              : input.trim()
                ? `No matches in the loaded ${noun}`
                : `No ${noun} loaded`
        }
        placeholder={`Search ${noun} by name or ID`}
        styles={styles}
      />
      {statusText && <Status id={describedBy}>{statusText}</Status>}
    </Label>
  )
}

/** react-select drops `aria-describedby`; append the picker status to its own description. */
function DescribedInput(props: InputProps<Option, false>) {
  const statusId = (props.selectProps as { statusId?: string }).statusId
  const own = props['aria-describedby']
  return (
    <components.Input
      {...props}
      aria-describedby={[own, statusId].filter(Boolean).join(' ') || undefined}
    />
  )
}

const pickerComponents = { Input: DescribedInput }

const styles: StylesConfig<Option, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 44,
    borderColor: state.isFocused ? color.accent : color.lineStrong,
    borderRadius: radius.input,
    borderStyle: state.isDisabled ? 'dashed' : 'solid',
    boxShadow: state.isFocused ? `0 0 0 2px ${color.accent}` : 'none',
    '&:hover': { borderColor: state.isFocused ? color.accent : color.lineStrong },
    background: state.isDisabled ? color.surface2 : color.surface,
  }),
  singleValue: (base, state) => ({
    ...base,
    color: state.isDisabled ? color.muted : color.fg,
  }),
  placeholder: (base) => ({ ...base, color: color.muted }),
  // react-select hides a disabled input, which removes the named combobox from assistive tech.
  input: (base) => ({ ...base, visibility: 'visible', color: color.fg }),
  menu: (base) => ({
    ...base,
    zIndex: 5,
    padding: 4,
    border: `1px solid ${color.line}`,
    borderRadius: radius.card,
    background: color.surface,
    boxShadow: shadow,
  }),
  option: (base, state) => ({
    ...base,
    padding: '6px 8px',
    borderRadius: radius.input,
    overflowWrap: 'anywhere',
    color: color.fg,
    background: state.isSelected || state.isFocused ? color.accentWeak : 'transparent',
    ':active': { backgroundColor: color.accentWeak, color: color.fg },
  }),
  noOptionsMessage: (base) => ({ ...base, color: color.muted }),
}

const Status = styled(Small)`
  font-weight: 400;
`
