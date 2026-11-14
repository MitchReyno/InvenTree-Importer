import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useNavigationGuard } from './useNavigationGuard'

const b = 'b0000000-0000-4000-8000-000000000001'

afterEach(() => {
  history.replaceState(null, '', location.pathname)
})

describe('legacy links and dirty drafts', () => {
  it('holds back a legacy link while a draft is dirty, before any redirect can run', () => {
    history.replaceState(null, '', `#${b}/capture`)
    const { result } = renderHook(() => useNavigationGuard())

    act(() => result.current.onDirtyChange(true))
    act(() => {
      history.pushState(null, '', `#${b}/approve/p1?x=1`)
      dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(result.current.route).toBe(`${b}/capture`)
    expect(result.current.navigationBlocked).toBe(true)
    expect(location.hash).toBe(`#${b}/capture`)
  })
})
