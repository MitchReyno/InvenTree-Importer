import { useEffect, useRef } from 'react'
import styled, { css } from 'styled-components'
import { media } from '#/components/ui'
import type { CurrentLayout, ElectronicsCurrentController } from '#/electronics-current/scene'
import type { ThemeId } from '#/theme/generated/tokens'
import { barGapMask, compactBarGapMask } from './current-masks'

// three.js r163+ renders through WebGL 2 only. Detect it before loading the
// scene chunk so unsupported browsers (and jsdom) never download three.js.
function supportsWebGl2(): boolean {
  return typeof window.WebGL2RenderingContext === 'function'
}

type SceneModule = typeof import('#/electronics-current/scene')

let sceneModule: Promise<SceneModule> | undefined

/** One load of the scene chunk shared by every mount; a failed load can be retried. */
function loadScene(): Promise<SceneModule> {
  sceneModule ??= import('#/electronics-current/scene').catch((error: unknown) => {
    sceneModule = undefined
    throw error
  })

  return sceneModule
}

function pageTheme(): ThemeId {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type ElectronicsCurrentProps = {
  /** `band` fills the masthead bar and masks itself to the gap between its text; a `field`
   * fills its container, which owns any mask. */
  layout?: CurrentLayout
}

/**
 * Decorative isometric electronics drifting behind the masthead title or the page. Purely
 * visual: hidden from assistive technology and never affects application state.
 */
export function ElectronicsCurrent({ layout = 'band' }: ElectronicsCurrentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas || !supportsWebGl2()) {
      return
    }

    let controller: ElectronicsCurrentController | null = null
    let unmounted = false

    async function start(target: HTMLCanvasElement): Promise<void> {
      const { createElectronicsCurrent } = await loadScene()

      if (unmounted) {
        return
      }

      controller = createElectronicsCurrent(target, {
        reducedMotion: prefersReducedMotion(),
        theme: pageTheme(),
        layout,
      })
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

    // The theme controller owns data-theme; the scene follows it without rebuilding parts.
    const themeObserver = new MutationObserver(() => controller?.setTheme(pageTheme()))
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    start(canvas).catch(handleStartFailure)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointercancel', handlePointerGone)
    window.addEventListener('scroll', handlePointerGone, { passive: true })
    document.documentElement.addEventListener('pointerleave', handlePointerGone)

    return () => {
      unmounted = true
      themeObserver.disconnect()
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointercancel', handlePointerGone)
      window.removeEventListener('scroll', handlePointerGone)
      document.documentElement.removeEventListener('pointerleave', handlePointerGone)
      controller?.dispose()
      controller = null
    }
  }, [layout])

  return (
    <Canvas ref={canvasRef} $layout={layout} aria-hidden="true" data-testid="electronics-current" />
  )
}

const Canvas = styled.canvas<{ $layout: CurrentLayout }>`
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
  ${({ $layout }) =>
    $layout === 'band' &&
    css`
      mask-image: ${barGapMask};

      ${media.compact} {
        mask-image: ${compactBarGapMask};
      }
    `}
`
