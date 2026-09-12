import { SaffronTheme } from './Theme'
import { sharedThemeConstants } from './shared'

export const lightTheme: SaffronTheme = {
  type: 'light',
  colors: {
    // Core background colors
    background: {
      base: '#FFFFFF',
      card: '#FFFFFF',
      subtle: '#D1D3D7',
      elevated: '#E0E1E4',
      secondary: '#D5D7DA',
      tertiary: '#C8CACF',
      white: '#FFFFFF',
      whiteSubtle: '#E5E6E8',
    },

    // Border colors
    border: {
      base: '#000000',
      faint: '#C8CACF',
      strong: '#333333',
      medium: '#333333',
      light: '#666666',
      white: '#FFFFFF',
      redHairline: 'rgba(220, 98, 98, 0.28)',
    },

    // Text colors
    text: {
      primary: '#0F1621',
      secondary: '#3B3B47',
      tertiary: '#4B505A',
      label: '#6B7280',
      inverse: '#FFFFFF',
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
      success: '#22C55E',
      error: '#C82E2E',
      warning: '#fcba03',
      info: '#2551A9',
      link: '#34BFF3',
      valid: '#22C55E',
      invalid: '#C82E2E',
      neutral: '#4B505A',
    },

    // Accent colors
    accent: {
      blue: '#3b8fed',
      green: '#22C55E',
      orange: '#e47e01',
      gold: '#FFBC09',
      yellow: '#FFEF15',
      purple: '#CA56ED',
    },

    // Yield / positive green
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
      overlay: 'rgba(0, 0, 0, 0.45)',
      hover: 'rgba(0, 0, 0, 0.04)',
      dotPattern: 'rgba(220, 38, 38, 0.1)',
      glowRed:
        'radial-gradient(75% 95% at 78% 0%, rgba(250,63,6,0.20), rgba(220,38,38,0.12) 38%, transparent 66%)',
      glowRing: '0 0 0 1px rgba(220,38,38,0.5), 0 0 24px rgba(220,38,38,0.28)',
      shadowPop: '0 8px 28px rgba(0,0,0,0.6)',
    },

    // Component-specific
    components: {
      tableGradient: {
        start: '#991B1B',
        mid: '#DC2626',
        end: '#991B1B',
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
        notStarted: '#22C55E', // green (accent.green) — Available reads as "open to deposit"
        started: '#B8860B', // dark gold
        ended: '#59D0FF', // cyan/blue
        closed: '#4B505A', // gray
      },
      positionBadge: {
        available: '#59D0FF', // cyan/blue (hex: hexToRgbString derives the soft fill)
      },
    },

    // Legacy
    icons: '#3B3B47',
    activated: '#3b8fed',
    type: sharedThemeConstants.colors.type,
  },
  fonts: {
    display: '\'Funnel Display\', serif',
    body: '\'Host Grotesk\', system-ui, sans-serif',
    mono: '\'Roboto Mono\', ui-monospace, monospace',
  },
}
