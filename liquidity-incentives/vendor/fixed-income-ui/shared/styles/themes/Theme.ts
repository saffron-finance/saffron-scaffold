// import original module declarations
import 'styled-components'

import { ThemeType } from './ThemeTypes'

export interface SaffronTheme {
  type: ThemeType
  colors: {
    // Core background/surface colors
    background: {
      base: string // #000000 - Pure black canvas
      card: string // #070606 - surface-card
      subtle: string // #0A0909 - surface-input (inputs / inset fields)
      elevated: string // #0E0C0C - surface-raised
      secondary: string // #0E0C0C - contrast surface (tooltips / modal sections)
      tertiary: string // #1A1717 - subtle hover step
      white: string // #FFFFFF - White surfaces
      whiteSubtle: string // #F5F5F5 - Off-white
    }

    // Border colors
    border: {
      base: string // #2A2422 - --line (standard hairline)
      faint: string // #1A1717 - --line-faint
      strong: string // #3A302C - --line-strong
      medium: string // #3A302C - Medium emphasis
      light: string // #E5E5E5 - Light borders
      white: string // #FFFFFF - White borders
      // The design's signature red hairline (--line). Used wherever a border
      // should read as brand rather than as neutral chrome: the featured token
      // cards and the nav's outlined buttons.
      redHairline: string // rgba(220,98,98,0.28)
    }

    // Text colors
    text: {
      primary: string // #FFFFFF - Main text
      secondary: string // #C9C4BE - Secondary text (design text-2)
      tertiary: string // #7E7A77 - Muted text (design text-dim)
      label: string // #9B9490 - Mono-caps labels (design text-label)
      inverse: string // #000000 - Text on white backgrounds
      onPrimary: string // #FFFFFF - Text on a brand-color fill (white in both themes)
    }

    // Primary brand color (Red)
    primary: {
      base: string // #F52A24
      hover: string // #FF4136
      active: string // #C81E18
      soft: string // rgba(245,42,36,0.14)
      saffron: string // #FA3F06
    }

    // Semantic colors
    semantic: {
      success: string
      error: string
      warning: string
      info: string
      link: string
      valid: string
      invalid: string
      neutral: string
    }

    // Accent colors
    accent: {
      blue: string // #3b8fed
      green: string // #4ADE80
      orange: string // #e47e01
      gold: string // #FFBC09 - design gold
      yellow: string // #FFEF15
      purple: string // #CA56ED
    }

    // Yield / positive green (design palette)
    green: {
      base: string // #1FA24A
      bg: string // #157A38
      soft: string // rgba(31,162,74,0.16)
      border: string // #009e23 - announcements bar border
    }

    // Warm off-white (brand creme)
    creme: string // #ECE7E0

    // Special effects
    effects: {
      overlay: string // rgba for modals
      hover: string // rgba for hover states
      dotPattern: string // rgba for background pattern
      glowRed: string // radial red focal glow
      glowRing: string // red ring shadow
      shadowPop: string // pop shadow
    }

    // Component-specific (only if truly unique)
    components: {
      tableGradient: {
        start: string
        mid: string
        end: string
      }
      depositButton: {
        base: string
        hover: string
      }
      side: {
        fixed: {
          background: string
          color: string
        }
        variable: {
          background: string
          color: string
        }
      }
      // Signal colors for the status dot + text (getStatusColor is the only
      // reader — never hardcode a status swatch at a call site).
      vaultStatus: {
        notStarted: string
        started: string
        ended: string
        closed: string
      }
      // Price-range "Available" pill. Deliberately NOT vaultStatus.notStarted:
      // the pill stays blue while the status dot/text is green.
      positionBadge: {
        available: string
      }
    }

    // Kept for specific legacy uses
    icons: string
    activated: string
    type: {
      red: string
      blue: string
    }
  }
  fonts: {
    display: string
    body: string
    mono: string
  }
}

// Use in react frontend repo to get DefaultTheme defined above
// declare module 'styled-components' {
//   export type DefaultTheme = SaffronTheme
// }
