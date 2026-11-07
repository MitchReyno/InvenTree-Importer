import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton, Spinner } from './Loading'

describe('Spinner and Skeleton', () => {
  it('are decorative', () => {
    const { container } = render(
      <>
        <Spinner />
        <Skeleton width="100%" height="80px" />
      </>,
    )

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2)
  })
})
