import type { SVGProps } from 'react'

// The design system's small SVG set, inlined so each icon takes the text colour. Everything else
// is a Unicode glyph in the text face.

type IconProps = SVGProps<SVGSVGElement>

const outline = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

/** The AI sparkle: a four-point star with curved sides, a small star and a dot. */
export function AiSparkleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable={false} {...props}>
      <path d="M10 3.5c.55 4.6 2.4 6.95 7.5 9.5-5.1 2.55-6.95 4.9-7.5 9.5-.55-4.6-2.4-6.95-7.5-9.5 5.1-2.55 6.95-4.9 7.5-9.5z" />
      <path d="M18.5 2c.3 1.75.95 2.7 2.9 3.5-1.95.8-2.6 1.75-2.9 3.5-.3-1.75-.95-2.7-2.9-3.5 1.95-.8 2.6-1.75 2.9-3.5z" />
      <circle cx="19.5" cy="18" r="1.3" />
    </svg>
  )
}

export function HelpIcon(props: IconProps) {
  return (
    <svg {...outline} strokeWidth={2.6} {...props}>
      <path d="M8.8 9.2a3.3 3.3 0 0 1 6.4 1.1c0 2.2-3.2 2.6-3.2 4.8" />
      <path d="M12 18.6h.01" />
    </svg>
  )
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...outline} strokeWidth={2.4} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6h.01" />
    </svg>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...outline} strokeWidth={1.8} {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...outline} strokeWidth={1.8} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

export function BackIcon(props: IconProps) {
  return (
    <svg {...outline} strokeWidth={1.8} {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  )
}
