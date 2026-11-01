// Colours for the masthead electronics animation. Fills are very light, muted
// tints of each part's real colour so the drawing stays quiet behind the title.

export const BACKGROUND_COLOUR = 0xf3f5f8

export const OUTLINE_COLOUR = 0x7d8ca3

export const CREASE_COLOUR = 0xbcc5d2

export const BASE_FILL = 0xf6f8fa

export const fills = {
  resistorBeige: 0xf1e9da,
  resistorBlue: 0xd6e3f3,
  gold: 0xe9d9ad,
  silver: 0xe3e7eb,
  ceramicDisc: 0xf4e4d2,
  blueCeramic: 0xc8daf1,
  monolithic: 0xf2e6c4,
  electrolytic: 0xccd8ea,
  sleeveStripe: 0xf2f4f7,
  aluminium: 0xedf0f3,
  epoxy: 0xd0d7e1,
  marking: 0xbcc6d3,
  diodeBand: 0xf0f2f5,
  glass: 0xf3e2c6,
  glassBand: 0xc3cad5,
  slug: 0xe6e9ed,
  trimmerBody: 0xcddaf0,
  rotor: 0xf4efe3,
  brass: 0xefe2bd,
  ferrite: 0xd2d6dc,
  copper: 0xefd2b8,
  tape: 0xf3e8bf,
  steel: 0xdfe3e8,
  hole: 0xc7ced8,
  darkPlastic: 0xc9d0db,
  tantalum: 0xf3e3b0,
  tantalumMark: 0xe0cf9f,
  slider: 0xfafbfc,
  label: 0xf8f9fa,
  cement: 0xf6f4ee,
  ceramicPackage: 0xd5d9df,
} as const

// Resistor colour code, black (0) to white (9), as light tints.
export const RESISTOR_CODE_FILLS = [
  0xc9ccd1, 0xdcc6b2, 0xebc4bd, 0xf1d2b4, 0xf2e6b0, 0xc6e2cf, 0xc4d7ee, 0xd6cce9, 0xd8dde2,
  0xf7f8f9,
] as const

// Film capacitor bodies and coloured button caps: red, yellow, green, blue.
export const PLASTIC_FILLS = [0xefcfca, 0xf4ebc4, 0xd2e6d6, 0xccdcf1] as const

// LED and display segment colours: red, amber, green, blue.
export const LED_COLOURS = [0xe0503c, 0xf0a030, 0x3fbf7f, 0x3b82f6] as const

export const DISPLAY_COLOURS = [0xe8705f, 0xeba640, 0x4fbf86] as const

export const UNLIT_SEGMENT = 0xbac2ce
