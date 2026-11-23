import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Each test starts without the session snapshots an earlier one stored.
afterEach(() => {
  cleanup()
  sessionStorage.clear()
})
