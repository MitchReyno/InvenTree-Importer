import type { SessionProgress } from './sessions.ts'
export interface NativePrompt {
  instructions: string
  text: string
  images: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }[]
}
export type NativeProgress = (progress: SessionProgress) => Promise<void>
