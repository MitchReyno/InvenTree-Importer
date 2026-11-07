import styled from 'styled-components'
import { color, radius } from '../../theme/generated/tokens'
import { motion, stillWhenReduced } from './motion'

export function Spinner({ size = 12 }: { size?: number }) {
  return <SpinnerRing aria-hidden="true" style={{ width: size, height: size }} />
}

export function Skeleton({ width, height }: { width: string; height: string }) {
  return <SkeletonBlock aria-hidden="true" style={{ width, height }} />
}

const SpinnerRing = styled.span`
  display: inline-block;
  flex: none;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: ${radius.round};
  ${motion.spin}
  ${stillWhenReduced}
`

const SkeletonBlock = styled.span`
  display: block;
  border-radius: ${radius.thumb};
  background: linear-gradient(90deg, ${color.surface2}, ${color.line}, ${color.surface2});
  background-size: 200% 100%;
  ${motion.sweep}
  ${stillWhenReduced}
`
