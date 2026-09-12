/** Retired pool IDs are URL aliases only, never shared accounting identities.
 * Old bookmarks/comparisons resolve to a fresh observation of the replacement. */
export const POOL_REPLACEMENTS: Record<string, string> = { 'zzz-eth-005': 'zzz-eth-1' }

/** Normalize before deduplication and the four-tile limit are applied. */
export const canonicalPoolId = (id: string): string => POOL_REPLACEMENTS[id] ?? id
