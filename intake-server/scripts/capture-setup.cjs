// Trusted explicit provisioning, not web startup. Does not discover any .env or contact inventory.
const { Pool } = require('pg')
const { devConfig } = require('../src/config.ts')
const { grantCapture } = require('../src/capture/grants.ts')
const { grantFoundation } = require('../src/operations/grants.ts')
async function main() {
  if (!process.env.INTAKE_DATABASE_URL || !process.env.INTAKE_CAPTURE_ROLE) throw new Error('explicit_capture_setup_required')
  const config = devConfig(process.env)
  const pool = new Pool({ connectionString: process.env.INTAKE_DATABASE_URL, max: 1 })
  try {
    await pool.query('BEGIN')
    await pool.query('INSERT INTO operator VALUES($1,\'development\',$2) ON CONFLICT DO NOTHING', [config.actorId, `development:${config.actorId}`])
    await pool.query('INSERT INTO target(id,current_context_id,profile) VALUES($1,$2,\'protected-read-only\') ON CONFLICT DO NOTHING', [config.targetId, config.targetContextId])
    await pool.query('INSERT INTO target_context VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING', [config.targetContextId, config.targetId, Buffer.alloc(32)])
    const result = await pool.query('SELECT 1 FROM operator o,target t,target_context c WHERE o.id=$1 AND o.identity_kind=\'development\' AND t.id=$2 AND t.current_context_id=$3 AND c.id=$3 AND c.target_id=t.id', [config.actorId, config.targetId, config.targetContextId])
    if (result.rowCount !== 1) throw new Error('capture_binding_conflict')
    await grantFoundation(pool, process.env.INTAKE_CAPTURE_ROLE)
    await grantCapture(pool, process.env.INTAKE_CAPTURE_ROLE)
    await pool.query('COMMIT')
    process.stdout.write('Capture development attribution and restricted grants provisioned; no inventory access qualified.\n')
  } finally { await pool.end() }
}
main().catch(() => { process.stderr.write('capture_setup_failed\n'); process.exitCode = 1 })
