const { watch } = require('node:fs')
const { readdir, readFile } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { join, relative, extname } = require('node:path')

const CODE = /\.(?:[cm]?[jt]sx?|css|html|sql)$/
const EXCLUDED =
  /(?:^|\/)(?:node_modules|dist|coverage|\.git|\.amp|\.cache|data|uploads)(?:\/|$)|\.(?:test|spec)\.[^.]+$/

function isCode(path) {
  return CODE.test(path) && !EXCLUDED.test(path.replaceAll('\\', '/'))
}

async function snapshot(root) {
  const files = []
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (EXCLUDED.test(relative(root, path))) {
        continue
      }
      if (item.isDirectory()) {
        await walk(path)
      } else if (item.isFile() && isCode(item.name)) {
        files.push(path)
      }
    }
  }
  await walk(root)
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(relative(root, file))
    hash.update(await readFile(file))
  }
  return hash.digest('hex')
}

/** Filesystem notifications are hints. Only changed source bytes schedule an application restart. */
async function watchCode(roots, changed, debounceMs = 200, initialDigests) {
  const digests = initialDigests ? [...initialDigests] : await Promise.all(roots.map(snapshot))
  let timer
  let stopped = false
  let checking = false
  let dirty = false
  async function check() {
    if (checking || stopped) {
      return
    }
    checking = true
    try {
      do {
        dirty = false
        const next = await Promise.all(roots.map(snapshot))
        if (next.some((digest, index) => digest !== digests[index])) {
          next.forEach((digest, index) => {
            digests[index] = digest
          })
          await changed()
        }
      } while (dirty && !stopped)
    } finally {
      checking = false
    }
  }
  const watchers = roots.map((root) =>
    watch(root, { recursive: true }, (_event, name) => {
      if (
        name &&
        (EXCLUDED.test(name.toString()) || (!isCode(name.toString()) && extname(name.toString())))
      ) {
        return
      }
      dirty = true
      clearTimeout(timer)
      timer = setTimeout(() => {
        void check().catch(changedError)
      }, debounceMs)
    }),
  )
  for (const watcher of watchers) {
    watcher.on('error', changedError)
  }
  try {
    await check()
  } catch (error) {
    stopped = true
    for (const watcher of watchers) {
      watcher.close()
    }
    throw error
  }

  function changedError(error) {
    stopped = true
    changed(error)
  }
  return () => {
    stopped = true
    clearTimeout(timer)
    for (const watcher of watchers) {
      watcher.close()
    }
  }
}
module.exports = { isCode, snapshot, watchCode }
