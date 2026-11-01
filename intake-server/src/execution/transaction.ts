/** No retries, including uncertain COMMITs. A borrowed pg client emits errors separately
 * from a rejected query when its socket disappears; consume both and destroy that client.
 * Caller reconnects only to INSPECT stable authority, never to retry a remote mutation.
 */
export { transaction as executorTransaction } from '../db/database.ts'
