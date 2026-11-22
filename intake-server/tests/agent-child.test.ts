import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { AgentChild, TOOL_SESSION_LIMITS } from '#/agents/child.ts'

/** A child that prints one JSON line about `bytes` long, as Claude echoes an image tool result. */
function echo(bytes: number, limits?: typeof TOOL_SESSION_LIMITS) {
  const script = `process.stdout.write(JSON.stringify({type:'user',data:'x'.repeat(${bytes})})+'\\n')`
  return new AgentChild(
    process.execPath,
    ['-e', script],
    tmpdir(),
    { PATH: process.env.PATH },
    new AbortController().signal,
    'lines',
    limits,
  )
}

// A delivered image is at most 1.25 MiB, so about 1.7 MB once base64-encoded in the echo.
const IMAGE_RESULT_BYTES = 1_800_000

test('a host session keeps its small frame limit', async () => {
  const child = echo(IMAGE_RESULT_BYTES)
  try {
    await assert.rejects(child.next(), /agent_frame_capacity/)
  } finally {
    await child.close()
  }
})

test('a tool session reads an echoed image tool result', async () => {
  const child = echo(IMAGE_RESULT_BYTES, TOOL_SESSION_LIMITS)
  try {
    const frame = (await child.next()) as { type: string; data: string }
    assert.equal(frame.type, 'user')
    assert.equal(frame.data.length, IMAGE_RESULT_BYTES)
  } finally {
    await child.close()
  }
})

test('a tool session still refuses a line beyond its own limit', async () => {
  const child = echo(TOOL_SESSION_LIMITS.frameBytes + 1, TOOL_SESSION_LIMITS)
  try {
    await assert.rejects(child.next(), /agent_frame_capacity/)
  } finally {
    await child.close()
  }
})

test('a reader that falls behind fails the turn before the queue outgrows its limit', async () => {
  // Five image-sized lines unread at once exceed the tool session's queue limit.
  const script = `for (let n = 0; n < 5; n++) process.stdout.write(JSON.stringify({type:'user',data:'x'.repeat(${IMAGE_RESULT_BYTES})})+'\\n')`
  const child = new AgentChild(
    process.execPath,
    ['-e', script],
    tmpdir(),
    { PATH: process.env.PATH },
    new AbortController().signal,
    'lines',
    TOOL_SESSION_LIMITS,
  )
  try {
    // Let the child print everything before reading anything.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await assert.rejects(
      (async () => {
        for (;;) {
          if ((await child.next()) === undefined) {
            return
          }
        }
      })(),
      /agent_output_capacity/,
    )
  } finally {
    await child.close()
  }
})
