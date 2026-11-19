/**
 * Session profiles share one handler; each has its own instruction digest and tool profile.
 * Only `shared-vm-agent/3` has the web tool surface.
 */
export const sessionHandlerVersion = 'processing/5'
export const sessionCommandQueue = 'bench-sessions'
export const sessionProfiles = {
  'shared-vm-agent/1': {
    instructionVersion: 'shared-vm-agent/1',
    instructionDigest: '75bd67342904a9578eaa04aceffd664d10dedf0d65743071aed95a36b644dc70',
    toolProfileVersion: 'native-session-tools/1',
  },
  'shared-vm-agent/2': {
    instructionVersion: 'shared-vm-agent/2',
    instructionDigest: '8695228770489604b189728dacca8822d6ec27a24f45ded88e7b5ed55b6d1b07',
    toolProfileVersion: 'native-session-tools/1',
  },
  'shared-vm-agent/3': {
    instructionVersion: 'shared-vm-agent/3',
    instructionDigest: '047abcc81e994911bb12d8856a84fee863e8c553c79c252f49acafda6329b9f2',
    toolProfileVersion: 'native-session-web-tools/1',
  },
  'native-agent/2': {
    instructionVersion: 'native-agent/2',
    instructionDigest: '75bd67342904a9578eaa04aceffd664d10dedf0d65743071aed95a36b644dc70',
    toolProfileVersion: 'native-session-tools/1',
  },
  'synthetic-session/1': {
    instructionVersion: 'synthetic-session/1',
    instructionDigest: '6ff8426a4836208006041d713846ef98e3c436cdbc6c019f69a5c8d590aec671',
    toolProfileVersion: 'native-session-tools/1',
  },
} as const
export type SessionProfileId = keyof typeof sessionProfiles

export function isSessionProfile(profileId: string): profileId is SessionProfileId {
  return Object.hasOwn(sessionProfiles, profileId)
}
