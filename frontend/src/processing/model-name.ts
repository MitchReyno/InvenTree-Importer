const CLAUDE_MODEL = /^claude-([a-z]+)-(\d+)-(\d+)$/

/** "Claude Opus 5.5" for a Claude model ID; any other ID is shown as the provider gave it. */
export function modelName(id: string) {
  const claude = CLAUDE_MODEL.exec(id)
  if (!claude) {
    return id
  }
  const [, family, major, minor] = claude
  return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`
}
