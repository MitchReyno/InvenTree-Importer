import { inventoryFake } from '../../tests/fixtures/inventory-fake.ts'
import { database } from '../db/database.ts'
import { readDevState } from './state.ts'

async function main() {
  const state = await readDevState(process.env.INTAKE_APP_STATE!)
  const db = database(state.fakeUrl)
  const port = Number(new URL(state.runnerConfig.profile.origin).port)
  const fake = await inventoryFake(db.pool, port, true, true, true, false)
  process.stdout.write('DEV_FAKE_READY\n')
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
  await fake.close()
  await db.close()
}

main().catch(() => {
  process.stderr.write('Owned development inventory stopped.\n')
  process.exitCode = 1
})
