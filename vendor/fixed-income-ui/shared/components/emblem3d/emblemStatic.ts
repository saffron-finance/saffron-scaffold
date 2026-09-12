/**
 * Why the nav emblem ended up static.
 *
 * Both the fallback still and a healthy-but-frozen canvas look identical on
 * screen — that is the whole point of the still (see the note in
 * Emblem3DLogo.tsx) — so "the logo doesn't spin" is the symptom of every
 * branch below and of none of them in particular. Without a reason on the
 * wire, a bug report about it is unanswerable.
 *
 * This module imports NOTHING on purpose: `Emblem3DLogo` reports these reasons
 * and must not pull in three.js, while `EmblemScene` (which is all three.js)
 * throws them.
 */

export type EmblemStaticReason =
  /** The browser would not give us a GL context at all. */
  | 'webgl-unavailable'
  /** emblem.glb failed to load — blocked, 404, or the network gave up. */
  | 'model-load'
  /** The matcap or blue-noise texture failed to load. */
  | 'texture-load'
  /** We had a context and the browser took it back (GPU reset, tab pressure). */
  | 'context-lost'
  /** The user asked not to download decorative extras. */
  | 'save-data'
  /** Working as intended: the emblem renders one frame and holds it. */
  | 'reduced-motion'
  /**
   * The load was never even scheduled — the IntersectionObserver never fired
   * even though the logo IS rendered. Seen for real in a tab that is never
   * painted (opened in the background, or restored by session restore):
   * nothing intersects, so the WebGL chunk is never fetched and the emblem
   * sits on the fallback indefinitely.
   *
   * Explicitly NOT the nav hiding the logo on small viewports — that is the
   * observer staying silent on purpose, and is filtered out before reporting.
   */
  | 'never-scheduled'
  /** Scheduled, but never became ready and never errored — a stalled load. */
  | 'load-stalled'
  | 'unknown'

/**
 * The subset a THROWN error may legitimately carry. Deliberately narrower than
 * the union above: nothing throws 'save-data', 'reduced-motion' or the
 * watchdog reasons, so an error arriving tagged with one is malformed and
 * classifies as 'unknown' rather than being trusted into the event stream.
 */
const ERROR_REASONS: ReadonlySet<string> = new Set<EmblemStaticReason>([
  'webgl-unavailable',
  'model-load',
  'texture-load',
  'context-lost',
  'unknown',
])

/** Error carrying the reason the emblem could not animate. */
export class EmblemError extends Error {
  readonly reason: EmblemStaticReason

  constructor(reason: EmblemStaticReason, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EmblemError'
    this.reason = reason
  }
}

/**
 * Reason behind an error thrown on the emblem's load path.
 *
 * Reads the tag `EmblemError` carries rather than matching on message text,
 * which would break the first time three.js rewords one of its own errors.
 * Deliberately duck-typed rather than `instanceof`: the thrower lives in the
 * lazily-imported three.js chunk and the caller in the entry chunk, so a
 * bundler that copies this module into both would give them two distinct
 * classes and `instanceof` would quietly answer 'unknown' for everything.
 */
export function classifyEmblemFailure(error: unknown): EmblemStaticReason {
  const reason = (error as { reason?: unknown } | null | undefined)?.reason
  return typeof reason === 'string' && ERROR_REASONS.has(reason)
    ? (reason as EmblemStaticReason)
    : 'unknown'
}

/**
 * How long the emblem may sit on the fallback — counting only time the page is
 * actually VISIBLE — before we call it stuck.
 *
 * Visible time, not wall-clock, is the whole point: a tab that is never looked
 * at is not a defect, and billing it as one would drown the signal in
 * background preloads. This measures the thing the user actually reported —
 * "I sat there looking at a logo that never moved".
 *
 * Generous, because the chunk plus its assets are ~760 KB and a slow
 * connection is not a bug. What this is for is the emblem never STARTING.
 */
export const STUCK_AFTER_VISIBLE_MS = 15_000

/**
 * Shared so the scene's decision to hold the emblem still and the telemetry
 * that reports it can never drift apart.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * The complement of {@link REDUCED_MOTION_QUERY}, asked only so the answer can
 * be checked against itself — see `motion_no_preference` below.
 */
export const MOTION_NO_PREFERENCE_QUERY = '(prefers-reduced-motion: no-preference)'

export const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION_QUERY).matches

/** Explicit data-saver preference, where the browser exposes one. */
export const saveDataEnabled = () =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true

/**
 * Environment attached to every emblem outcome, static or animating.
 *
 * `motion_no_preference` is the field that earns its place. The two motion
 * queries are exact complements in a browser that implements them correctly, so
 * a report carrying true/true or false/false is a UA answering the motion query
 * incorrectly rather than a user who asked for less motion. Without it,
 * 'reduced-motion' is unfalsifiable: the reason is emitted only when the query
 * matched, so the query's value on that event tells us nothing we had not
 * already assumed, and "everyone prefers reduced motion" and "the query is
 * wrong" stay indistinguishable — while calling for opposite fixes.
 *
 * `reduced_motion` is therefore redundant on an `emblem_static`/'reduced-motion'
 * event and carried anyway, for the OTHER outcomes: it is the only way to see a
 * browser that claims to want less motion and animated regardless.
 */
export interface EmblemEnvironment {
  reduced_motion: boolean
  motion_no_preference: boolean
  save_data: boolean
  /**
   * Visibility at report time. The watchdog only counts down while visible, so
   * a 'never-scheduled' from a hidden page would mean the budget was spent
   * before the tab was backgrounded — a different story from one reported by a
   * page the user was looking at the whole time.
   */
  visibility: DocumentVisibilityState
}

export function emblemEnvironment(): EmblemEnvironment {
  return {
    reduced_motion: prefersReducedMotion(),
    motion_no_preference: window.matchMedia(MOTION_NO_PREFERENCE_QUERY).matches,
    save_data: saveDataEnabled(),
    visibility: document.visibilityState,
  }
}
