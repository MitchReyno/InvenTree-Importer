import { useEffect, useRef } from 'react'
import styled from 'styled-components'
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

    function handlePointerLeavePage(): void {
      controller?.clearPointer()
    }

    // The scene chunk failing to load leaves a plain masthead; nothing depends on it.
    start(canvas).catch(() => undefined)
    window.addEventListener('pointermove', handlePointerMove)
    document.documentElement.addEventListener('pointerleave', handlePointerLeavePage)

    return () => {
      unmounted = true
      window.removeEventListener('pointermove', handlePointerMove)
      document.documentElement.removeEventListener('pointerleave', handlePointerLeavePage)
      controller?.dispose()
      controller = null
    }
  }, [])

  return <Canvas ref={canvasRef} aria-hidden="true" data-testid="electronics-current" />
}

// Parts fade out under the title (left) and the workflow label (right).
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
    transparent 140px,
    #000 330px,
    #000 calc(100% - 230px),
    transparent calc(100% - 120px)
  );

  /* Narrow screens leave little room between title and label, so parts dim under
     the text instead of disappearing. */
  @media (max-width: 700px) {
    mask-image: linear-gradient(
      to right,
      rgb(0 0 0 / 25%) 0,
      rgb(0 0 0 / 25%) 140px,
      #000 175px,
      #000 calc(100% - 150px),
      rgb(0 0 0 / 25%) calc(100% - 125px)
    );
  }
`
