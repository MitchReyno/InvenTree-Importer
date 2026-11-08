/** Session profiles share one handler and tool profile; each has its own instruction digest. */
export const sessionHandlerVersion = 'processing/5'
export const sessionToolProfileVersion = 'native-session-tools/1'
export const sessionCommandQueue = 'bench-sessions'
export const sessionProfiles = {
  'shared-vm-agent/1': {
    instructionVersion: 'shared-vm-agent/1',
    instructionDigest: '75bd67342904a9578eaa04aceffd664d10dedf0d65743071aed95a36b644dc70',
  },
  'native-agent/2': {
    instructionVersion: 'native-agent/2',
    instructionDigest: '75bd67342904a9578eaa04aceffd664d10dedf0d65743071aed95a36b644dc70',
  },
  'synthetic-session/1': {
    instructionVersion: 'synthetic-session/1',
    instructionDigest: '6ff8426a4836208006041d713846ef98e3c436cdbc6c019f69a5c8d590aec671',
  },
} as const
export type SessionProfileId = keyof typeof sessionProfiles

export function isSessionProfile(profileId: string): profileId is SessionProfileId {
  return Object.hasOwn(sessionProfiles, profileId)
}
