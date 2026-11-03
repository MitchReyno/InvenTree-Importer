import {
  mediaProfileId,
  mediaHandlerVersion,
  researchProfileId,
  researchHandlerVersion,
  type SelectedProcessingProfile,
} from '../processing/model.ts'
import { nativeProfileId, nativeHandlerVersion } from './policy.ts'

export function processingHandler(profile: SelectedProcessingProfile | undefined) {
  if (profile === nativeProfileId) {
    return nativeHandlerVersion
  }
  if (profile === researchProfileId) {
    return researchHandlerVersion
  }
  return mediaHandlerVersion
}

export function runnerQualificationMatches(
  profile: SelectedProcessingProfile,
  qualification: string,
) {
  if (profile === nativeProfileId) {
    return qualification === 'native_unverified'
  }
  return [mediaProfileId, researchProfileId].includes(profile) && qualification === 'fixture_only'
}
