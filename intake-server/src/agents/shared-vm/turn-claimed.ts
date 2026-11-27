/**
 * The line a guest writes to its standard error once the coordinator has claimed its connection,
 * so the relay can open the next one. `tooling/deployment/bridge/relay.mjs` matches the same text.
 */
export const TURN_CLAIMED_MARKER = 'bench-turn-claimed'
