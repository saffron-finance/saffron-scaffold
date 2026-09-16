import { useEffect, useRef, useState } from 'react'
import { loadFixedRanges, type FixedRange } from './fixedRange'
import type { VariableVault } from './vaults'

/** Best-effort reads have a terminal unavailable state, not an implicit retry.
 * One batch at a time; explicit retries have a 30-second cooldown. Omissions and
 * rejected reads never replace an unchanged Map or trigger a render/read loop. */
export function useFixedRanges(vaults: VariableVault[], enabled: boolean) {
  const [ranges, setRanges] = useState(new Map<string, FixedRange>())
  const [version, setVersion] = useState(0)
  const [retryReady, setRetryReady] = useState(false)
  const attempted = useRef(new Set<string>())
  const active = useRef(false)
  const alive = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [])
  useEffect(() => {
    const keys = new Set(vaults.map(v => v.vault.toLowerCase()))
    for (const key of attempted.current) if (!keys.has(key)) attempted.current.delete(key)
    if (!enabled || active.current) return
    const missing = vaults.filter(v => !ranges.has(v.vault.toLowerCase()) && !attempted.current.has(v.vault.toLowerCase()))
    if (!missing.length) return
    active.current = true
    for (const v of missing) attempted.current.add(v.vault.toLowerCase())
    void loadFixedRanges(missing).then(loaded => {
      if (!alive.current || !loaded.size) return
      setRanges(current => {
        let next = current
        for (const [key, value] of loaded) if (!current.has(key)) {
          if (next === current) next = new Map(current)
          next.set(key, value)
        }
        return next
      })
    }).catch(() => { /* The attempted set exposes failed reads as unavailable. */ }).finally(() => {
      active.current = false
      if (!alive.current) return
      setVersion(v => v + 1)
      setRetryReady(false)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => { if (alive.current) setRetryReady(true) }, 30_000)
    })
  }, [vaults, ranges, enabled, version])
  const unavailable = vaults.filter(v => attempted.current.has(v.vault.toLowerCase()) && !ranges.has(v.vault.toLowerCase())).length
  return { ranges, setRanges, unavailable, retryReady: retryReady && !active.current,
    retry: () => {
      if (!retryReady || active.current) return
      attempted.current.clear(); setRetryReady(false); setVersion(v => v + 1)
    } }
}
