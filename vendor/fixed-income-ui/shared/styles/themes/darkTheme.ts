import { SaffronTheme } from './Theme'
import { sharedThemeConstants } from './shared'

export const darkTheme: SaffronTheme = {
  type: 'dark',
  colors: {
    // Core background colors — aligned to the design's dark surface ramp
    // (canvas → input → raised) instead of the old flat greys, so every
    // theme.colors.background.* consumer matches the design system.
    background: {
      base: '#000000',
      card: '#070606', // surface-card (cards / panels)
      subtle: '#0A0909', // surface-input (inputs / inset fields)
      elevated: '#0E0C0C', // surface-raised (cards / panels / raised)
      secondary: '#0E0C0C', // contrast surface (tooltips / modal sections / buttons)
      tertiary: '#1A1717', // line-faint — a subtle hover step above secondary
      white: '#FFFFFF',
      whiteSubtle: '#F5F5F5',
    },

    // Border colors — the design's warm hairline ramp (the old base #2A2A2A was a
    // neutral grey mislabelled as --line; the real --line is the warmer #2A2422).
    border: {
      base: '#2A2422', // --line
      faint: '#1A1717', // --line-faint
      strong: '#3A302C', // --line-strong
      medium: '#3A302C',
      light: '#E5E5E5',
      white: '#FFFFFF',
      redHairline: 'rgba(220, 98, 98, 0.28)', // --line, the signature red hairline
    },

    // Text colors — design palette
    text: {
      primary: '#FFFFFF',
      secondary: '#C9C4BE', // design text-2
      tertiary: '#7E7A77', // design text-dim
      label: '#9B9490', // design text-label (mono caps labels)
      inverse: '#000000',
      onPrimary: '#FFFFFF', // text on a brand-color fill — white in both themes
    },

    // Primary brand color (Saffron brand red)
    primary: {
      base: '#F52A24',
      hover: '#FF4136',
      active: '#C81E18',
      soft: 'rgba(245,42,36,0.14)',
      saffron: '#FA3F06',
    },

    // Semantic colors
    semantic: {
      success: '#4ADE80',
      error: '#C82E2E',
      warning: '#fcba03',
      info: '#2551A9',
      link: '#34BFF3',
      valid: '#4ADE80',
      invalid: '#C82E2E',
      neutral: '#9CA3AF',
    },

    // Accent colors
    accent: {
      blue: '#3b8fed',
      green: '#4ADE80',
      orange: '#e47e01',
      gold: '#FFBC09', // design gold (yield)
      yellow: '#FFEF15',
      purple: '#CA56ED',
    },

    // Yield / positive green (design palette — distinct from the brighter
    // accent.green used for semantic success)
    green: {
      base: '#1FA24A',
      bg: '#157A38',
      soft: 'rgba(31,162,74,0.16)',
      border: '#009e23',
    },

    // Warm off-white (brand creme)
    creme: '#ECE7E0',

    // Special effects
    effects: {
      overlay: 'rgba(46, 46, 48, 0.82)',
      hover: 'rgba(255, 255, 255, 0.03)',
      dotPattern: 'rgba(139, 69, 69, 0.3)',
      // Red focal glow at the top-right of a card (the design's "Red focal glow").
      // The faint marble texture wash is layered separately via the MARBLE_WASH mixin.
      glowRed:
        'radial-gradient(75% 95% at 78% 0%, rgba(250,63,6,0.15), rgba(220,38,38,0.08) 38%, transparent 66%)',
      glowRing: '0 0 0 1px rgba(220,38,38,0.5), 0 0 24px rgba(220,38,38,0.28)',
      shadowPop: '0 8px 28px rgba(0,0,0,0.6)',
    },

    // Component-specific
    components: {
      tableGradient: {
        start: '#B91C1C',
        mid: '#DC2626',
        end: '#B91C1C',
      },
      depositButton: {
        base: '#22C55E',
        hover: '#16A34A',
      },
      side: {
        fixed: {
          background: 'rgb(104 175 255 / 13%)',
          color: 'rgb(135 160 255)',
        },
        variable: {
          background: 'rgb(255 0 248 / 13%)',
          color: 'rgb(255 0 243)',
        },
      },
      vaultStatus: {
        notStarted: '#4ADE80', // green (accent.green) — Available reads as "open to deposit"
        started: 'rgb(255 239 21)', // yellow
        ended: '#59D0FF', // cyan/blue
        closed: '#9CA3AF', // gray
      },
      positionBadge: {
        available: '#59D0FF', // cyan/blue (hex: hexToRgbString derives the soft fill)
      },
    },

    // Legacy
    icons: '#FFFFFF',
    activated: '#3b8fed',
    type: sharedThemeConstants.colors.type,
  },
  fonts: {
    display: '\'Funnel Display\', serif',
    body: '\'Host Grotesk\', system-ui, sans-serif',
    mono: '\'Roboto Mono\', ui-monospace, monospace',
  },
}
