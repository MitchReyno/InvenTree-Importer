import { request } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

interface Stats {
  memory_stats?: { usage?: number; max_usage?: number }
  cpu_stats?: { cpu_usage?: { total_usage?: number } }
}

/** Query only the named synthetic container on the local engine. Its first and last polls may return 404. */
async function stats(socketPath: string, name: string): Promise<Stats | undefined> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: '/containers/' + name + '/stats?stream=false&one-shot=true',
        timeout: 1500,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('error', reject)
        res.on('end', () => {
          try {
            if (res.statusCode === 404) resolve(undefined)
            else if (res.statusCode === 200) resolve(JSON.parse(body))
            else reject(new Error('engine stats returned ' + res.statusCode))
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('engine stats timeout')))
    req.on('error', reject)
    req.end()
  })
}

export function decoderResources(socketPath: string) {
  const live = new Map<string, number>()
  let peakChildBytes = 0,
    totalCpuNs = 0,
    samples = 0
  async function observe(name: string, signal: AbortSignal) {
    let cpu = 0
    try {
      while (!signal.aborted) {
        const sample = await stats(socketPath, name)
        if (sample?.memory_stats?.usage) {
          samples++
          live.set(name, sample.memory_stats.usage)
          peakChildBytes = Math.max(
            peakChildBytes,
            [...live.values()].reduce((a, b) => a + b, 0),
          )
          cpu = Math.max(cpu, sample.cpu_stats?.cpu_usage?.total_usage ?? 0)
        }
        await delay(150)
      }
    } finally {
      live.delete(name)
      totalCpuNs += cpu
    }
  }
  return {
    observe,
    result: () => ({
      peakSampledDecoderBytes: peakChildBytes,
      sampledDecoderCpuSec: totalCpuNs / 1e9,
      engineSamples: samples,
    }),
  }
}
