import { aprTextGradient } from '../host/aprTextStyle'

/** Staging-only motion presets. CSS owns every frame; no React timer, data
 * refresh, or layout animation is involved. Short text paint areas keep the
 * effects light, while the browser schedules them at the display refresh rate. */
export const aprAnimations = [
  { id: 'none', label: 'No animation', description: 'The current static red-orange gradient.' },
  { id: 'drift', label: 'Horizontal drift', description: 'A gentle side-to-side color flow · 18 seconds.' },
  { id: 'diagonal', label: 'Diagonal sweep', description: 'Warm colors drift diagonally · 20 seconds.' },
  { id: 'shimmer', label: 'Soft shimmer', description: 'A soft gold highlight passes across the numbers · 12 seconds.' },
  { id: 'breathe', label: 'Breathing glow', description: 'The gradient slowly brightens and settles · 10 seconds.' },
  { id: 'orbit', label: 'Sunset orbit', description: 'A warm radial highlight follows a slow loop.' },
  { id: 'waves', label: 'Color waves', description: 'Two warm color layers drift in opposite directions · 22 seconds.' },
] as const

export type AprAnimation = typeof aprAnimations[number]['id']

/** Whitelist persisted choices; never interpolate browser storage into CSS. */
export function validAprAnimation(value: unknown): value is AprAnimation {
  return aprAnimations.some(animation => animation.id === value)
}

const gradient = aprTextGradient
const selector = '[data-incentive-apr], [data-apr-navigation]'
// The badge and APR share one orbit timeline. Only a new offer's NEW
// badge gets the requested surface; the row and other badges stay unchanged.
// Important applies to the image, not the shorthand, so position can animate.
export const newOfferBadgeCss = `
  @keyframes saffronAprOrbit {
    0%, 100% { background-position:0% 50%; }
    25% { background-position:50% 0%; }
    50% { background-position:100% 50%; }
    75% { background-position:50% 100%; }
  }
  [data-incentive-new] {
    background-image:${gradient} !important;
    background-size:200% 200%; animation:saffronAprOrbit var(--saffron-orbit-duration, 24s) linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    [data-incentive-new] {
      animation:none !important; background-size:100% 100%; background-position:0% 0%;
    }
  }
`
// Each loop joins equal endpoints, or alternates direction, to avoid a snap.
const presets: Record<Exclude<AprAnimation, 'none'>, string> = {
  drift: `
    ${selector} { background-size:220% 100%; animation:saffronAprDrift 18s ease-in-out infinite alternate; }
    @keyframes saffronAprDrift { from { background-position:0% 50%; } to { background-position:100% 50%; } }
  `,
  diagonal: `
    ${selector} { background-size:220% 220%; animation:saffronAprDiagonal 20s ease-in-out infinite alternate; }
    @keyframes saffronAprDiagonal { from { background-position:0% 0%; } to { background-position:100% 100%; } }
  `,
  shimmer: `
    ${selector} {
      background-image:linear-gradient(110deg, transparent 38%, rgba(255, 222, 150, .72) 50%, transparent 62%), ${gradient};
      background-size:300% 100%, 100% 100%; background-repeat:no-repeat;
      animation:saffronAprShimmer 12s linear infinite;
    }
    @keyframes saffronAprShimmer {
      from { background-position:-100% 0%, 0% 0%; }
      to { background-position:100% 0%, 0% 0%; }
    }
  `,
  breathe: `
    ${selector} { animation:saffronAprBreathe 10s ease-in-out infinite; }
    @keyframes saffronAprBreathe {
      0%, 100% { filter:brightness(1) saturate(1); }
      50% { filter:brightness(1.16) saturate(1.12); }
    }
  `,
  orbit: `
    ${selector} {
      background-image:radial-gradient(ellipse at center, rgb(255, 188, 9) 12%, rgb(228, 126, 1) 48%, rgb(250, 63, 6) 80%);
      background-size:200% 200%; animation:saffronAprOrbit var(--saffron-orbit-duration, 24s) linear infinite;
    }
    /* Modal orbit is fixed at 1.5x (24 / 1.5), independent of the page slider. */
    [role="dialog"] [data-incentive-apr] { --saffron-orbit-duration:16s; }
  `,
  waves: `
    ${selector} {
      background-image:radial-gradient(ellipse at center, rgba(255, 188, 9, .85), transparent 65%), ${gradient};
      background-size:180% 160%, 220% 100%; animation:saffronAprWaves 22s ease-in-out infinite alternate;
    }
    @keyframes saffronAprWaves {
      from { background-position:0% 20%, 100% 50%; }
      to { background-position:100% 80%, 0% 50%; }
    }
  `,
}

/** Selecting None removes every override, restoring the exact approved style.
 * Reduced motion also restores that static look without erasing the preference. */
export function aprAnimationCss(animation: AprAnimation): string {
  if (animation === 'none') return ''
  return `${presets[animation]}
    @media (prefers-reduced-motion: reduce) {
      ${selector} {
        animation:none !important; filter:none !important;
        background-image:${gradient} !important;
        background-size:100% 100% !important; background-position:0% 0% !important;
      }
    }
  `
}
