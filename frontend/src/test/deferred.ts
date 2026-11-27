/** A promise the test settles itself, for a read held in flight. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('deferred_not_ready')
  }

  let reject: (reason: unknown) => void = () => {
    throw new Error('deferred_not_ready')
  }

  const promise = new Promise<T>((finish, fail) => {
    resolve = finish
    reject = fail
  })
  return { promise, resolve, reject }
}
