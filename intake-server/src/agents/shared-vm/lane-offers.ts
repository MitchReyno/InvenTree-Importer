import type { Socket } from 'node:net'

/**
 * A connection's loopback peer, which identifies it while it is open; a TLS socket reports its
 * transport's, so a started offer is found again once its guest has been admitted.
 */
export function peerKey(socket: { remoteAddress?: string; remotePort?: number }) {
  return `${socket.remoteAddress ?? ''}:${socket.remotePort ?? ''}`
}

/** What the coordinator writes on an offer to have its relay start the guest. */
export const LANE_START = 'go\n'

/** An offer line is short; anything longer is refused. */
export const MAX_OFFER_BYTES = 64

/**
 * The route key a relay lane's offer names, as `routeKey` in the coordinator spells it, or
 * undefined. The offer is the first line a lane writes, before any guest exists: `bench-lane/1`,
 * the subscription it serves (`none` for the general relay) and whether its guests have tools.
 */
export function offerRoute(line: string) {
  const match = /^bench-lane\/1 (claude|codex|none) (tools|plain)$/.exec(line)
  if (!match) {
    return undefined
  }
  return `${match[1]}:${match[2]}`
}

/**
 * Open lane offers and the guests started from them, per route. A route's waiters (turns and
 * probes with no idle connection) each get at most one starting guest, so polling starts no more.
 */
export class LaneOffers {
  private readonly offers = new Map<string, Set<Socket>>()
  // Guests asked for and not yet admitted, by route, then by peer.
  private readonly starting = new Map<string, Map<string, Socket>>()
  private readonly waiters = new Map<string, number>()
  private readonly offered = new Map<string, number>()
  private readonly retryAt = new Map<string, number>()

  /** `retryMs` spaces the starts of a route whose last guest closed before it was admitted. */
  constructor(
    readonly limit: number,
    private readonly retryMs: number,
  ) {}

  /** Open offers across routes. */
  get size() {
    let open = 0
    for (const sockets of this.offers.values()) {
      open += sockets.size
    }
    return open
  }

  /** Keeps an offer until it is started or closes. */
  add(route: string, socket: Socket) {
    setOf(this.offers, route).add(socket)
    this.offered.set(route, (this.offered.get(route) ?? 0) + 1)
    socket.once('close', () => this.offers.get(route)?.delete(socket))
  }

  /** Whether the route has an open offer: its relay is running. */
  hasOffer(route: string) {
    return (this.offers.get(route)?.size ?? 0) > 0
  }

  /** Offers ever made for the route, so a waiter sees one that came and went between samples. */
  offersMade(route: string) {
    return this.offered.get(route) ?? 0
  }

  /**
   * Registers a waiter of the route until the returned function is called. A waiter that leaves
   * stops a starting guest no remaining waiter needs, so its containers don't keep starting.
   */
  wait(route: string) {
    this.waiters.set(route, (this.waiters.get(route) ?? 0) + 1)
    let left = false
    return () => {
      if (left) {
        return
      }
      left = true
      const waiting = (this.waiters.get(route) ?? 1) - 1
      this.waiters.set(route, waiting)
      const starting = [...(this.starting.get(route)?.values() ?? [])]
      for (const socket of starting.slice(waiting)) {
        socket.destroy()
      }
    }
  }

  /**
   * The offer to start a guest on, taken from the open ones, when the route's waiters outnumber
   * its starting guests; undefined otherwise. The caller writes `LANE_START` and admits it.
   */
  next(route: string, now = Date.now()) {
    let starting = this.starting.get(route)
    if (!starting) {
      starting = new Map()
      this.starting.set(route, starting)
    }
    if ((this.waiters.get(route) ?? 0) <= starting.size || now < (this.retryAt.get(route) ?? 0)) {
      return undefined
    }
    const offer = this.offers.get(route)?.values().next()
    if (!offer || offer.done) {
      return undefined
    }
    const socket = offer.value
    const peer = peerKey(socket)
    this.offers.get(route)!.delete(socket)
    starting.set(peer, socket)
    socket.once('close', () => {
      // Closed before it was admitted: the next start of this route waits a little.
      if (starting.delete(peer)) {
        this.retryAt.set(route, Date.now() + this.retryMs)
      }
    })
    return socket
  }

  /** Whether the connection from `peer` was started from an offer and not yet admitted. */
  isStarting(peer: string) {
    return [...this.starting.values()].some((starting) => starting.has(peer))
  }

  /** The guest started for `peer` was admitted; it no longer counts as starting. */
  admitted(peer: string) {
    for (const starting of this.starting.values()) {
      starting.delete(peer)
    }
  }
}

function setOf(map: Map<string, Set<Socket>>, route: string) {
  let set = map.get(route)
  if (!set) {
    set = new Set()
    map.set(route, set)
  }
  return set
}
