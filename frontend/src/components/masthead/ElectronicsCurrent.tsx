import { useEffect, useRef } from 'react'
import styled from 'styled-components'
import { media } from '../ui/media'
import type { ElectronicsCurrentController } from '../../electronics-current/scene'

// three.js r163+ renders through WebGL 2 only. Detect it before loading the
// scene chunk so unsupported browsers (and jsdom) never download three.js.
function supportsWebGl2(): boolean {
  return typeof window.WebGL2RenderingContext === 'function'
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Mask opacity, not a colour: parts under compact text stay at a quarter strength.
const DIMMED = 'color-mix(in srgb, black 25%, transparent)'

/**
 * Decorative isometric electronics drifting behind the masthead title. Purely
 * visual: hidden from assistive technology and never affects application state.
 */
export function ElectronicsCurrent() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas || !supportsWebGl2()) {
      return
    }

    let controller: ElectronicsCurrentController | null = null
    let unmounted = false

    async function start(target: HTMLCanvasElement): Promise<void> {
      const { createElectronicsCurrent } = await import('../../electronics-current/scene')

      if (unmounted) {
        return
      }

      controller = createElectronicsCurrent(target, { reducedMotion: prefersReducedMotion() })
    }

    function handlePointerMove(event: PointerEvent): void {
      controller?.setPointer(event.clientX, event.clientY)
    }

    // Leaving the page, cancelling or scrolling leaves the pointer somewhere new.
    function handlePointerGone(): void {
      controller?.clearPointer()
    }

    function handleStartFailure(error: unknown): void {
      // The masthead stays plain text; nothing depends on the animation.
      if (import.meta.env.DEV) {
        console.warn('Masthead animation unavailable', error)
      }
    }

    start(canvas).catch(handleStartFailure)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointercancel', handlePointerGone)
    window.addEventListener('scroll', handlePointerGone, { passive: true })
    document.documentElement.addEventListener('pointerleave', handlePointerGone)

    return () => {
      unmounted = true
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointercancel', handlePointerGone)
      window.removeEventListener('scroll', handlePointerGone)
      document.documentElement.removeEventListener('pointerleave', handlePointerGone)
      controller?.dispose()
      controller = null
    }
  }, [])

  return <Canvas ref={canvasRef} aria-hidden="true" data-testid="electronics-current" />
}

// Parts show only between the left text and the status controls. The masthead measures the
// four stops; the fallbacks are the default layout's.
const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
  mask-image: linear-gradient(
    to right,
    transparent 0,
    transparent var(--current-clear-start, 460px),
    black var(--current-opaque-start, 600px),
    black var(--current-opaque-end, calc(100% - 420px)),
    transparent var(--current-clear-end, calc(100% - 300px))
  );

  /* The compact bar leaves little room between its ends, so parts dim under the text
     instead of disappearing. */
  ${media.compact} {
    mask-image: linear-gradient(
      to right,
      ${DIMMED} 0,
      ${DIMMED} 200px,
      black 240px,
      black calc(100% - 200px),
      ${DIMMED} calc(100% - 170px)
    );
  }
`
