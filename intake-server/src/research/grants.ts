import type { Pool } from 'pg'

/** Research receipts grant neither capture edits nor source/network/provider capabilities. */
export async function grantResearch(pool: Pool, role: string, purpose: 'api' | 'runner') {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) {
    throw new Error('invalid_runtime_role')
  }
  await pool.query(`GRANT SELECT ON research_receipt TO ${role}`)
  if (purpose === 'runner') {
    await pool.query(`GRANT INSERT ON research_receipt TO ${role}`)
  }
}
