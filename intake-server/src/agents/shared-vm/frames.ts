// Length-prefixed, sequential messages. Reject the declared length before allocating a frame.
import type { Duplex } from 'node:stream'

const limit = 4 * 1024 * 1024
export const protocol = 'bench-vm-turn/1'
export class Frames {
  private readonly chunks: AsyncIterator<Buffer>
  private remainder = Buffer.alloc(0)

  constructor(private readonly socket: Duplex) {
    this.chunks = socket[Symbol.asyncIterator]()
  }

  private async bytes(size: number) {
    const result = Buffer.allocUnsafe(size)
    let offset = 0
    while (offset < size) {
      if (!this.remainder.length) {
        const next = await this.chunks.next()
        if (next.done) {
          throw new Error('runner_disconnected')
        }
        this.remainder = Buffer.from(next.value)
      }
      const count = Math.min(size - offset, this.remainder.length)
      this.remainder.copy(result, offset, 0, count)
      this.remainder = this.remainder.subarray(count)
      offset += count
    }
    return result
  }

  async read(): Promise<Record<string, unknown>> {
    const size = (await this.bytes(4)).readUInt32BE()
    if (size === 0 || size > limit) {
      throw new Error('invalid_runner_frame')
    }
    const value = JSON.parse((await this.bytes(size)).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid_runner_frame')
    }
    return value
  }

  async send(value: Record<string, unknown>) {
    const data = Buffer.from(JSON.stringify(value))
    if (data.length > limit) {
      throw new Error('runner_frame_limit')
    }
    const header = Buffer.allocUnsafe(4)
    header.writeUInt32BE(data.length)
    await new Promise<void>((resolve, reject) =>
      this.socket.write(Buffer.concat([header, data]), (error) =>
        error ? reject(error) : resolve(),
      ),
    )
  }
}

export async function readBounded(stream: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit / 2) {
      throw new Error('runner_frame_limit')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
