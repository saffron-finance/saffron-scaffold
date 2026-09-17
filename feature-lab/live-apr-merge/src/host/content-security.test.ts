import { afterEach, expect, it, vi } from 'vitest'
import { appearanceCss, savedAppearance, savedTypography, typographyKey, storageKey, defaultsVersion } from '../dev/appearancePreferences'
import { tokenArtwork } from '../incentives/tokenArtwork'
import { saveCatalogDisplay, initialCatalog, cacheKey } from './catalogSnapshot'
import { safeNavigationHref } from './safeNavigation'

afterEach(() => { localStorage.clear(); vi.unstubAllEnvs(); vi.resetModules() })
it('SEC-CONTENT-004 persisted colors fonts and presets cannot introduce CSS imports', () => {
  const injection = 'red;} @import url(https://example.invalid);/*'
  localStorage.setItem(storageKey, JSON.stringify({ defaultsVersion, surfaceTop: injection, gradientStart: injection, style: injection }))
  localStorage.setItem(typographyKey, JSON.stringify({ font: injection, aprAnimation: injection }))
  const css = appearanceCss(savedTypography(), savedAppearance())
  expect(css).not.toContain('example.invalid'); expect(css).not.toContain('@import')
})
it('SEC-CONTENT-005 numeric settings cannot escape CSS declarations', () => {
  localStorage.setItem(storageKey, JSON.stringify({ defaultsVersion, radius: '1px;color:red', angle: 99999999, orbitSpeed: 0 }))
  localStorage.setItem(typographyKey, JSON.stringify({ comingSoonDefaultVersion: 1, comingSoonAngle: '0);background:url(https://example.invalid)', orbitSpeed: -1 }))
  const css = appearanceCss(savedTypography(), savedAppearance())
  expect(css).not.toContain('example.invalid'); expect(css).not.toContain('Infinity'); expect(css).not.toContain('99999999')
})
it('SEC-CONTENT-009 persisted prototype properties do not enter default objects', () => {
  localStorage.setItem(storageKey, '{"defaultsVersion":2,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}')
  expect(savedAppearance()).not.toHaveProperty('polluted'); expect(({} as any).polluted).toBeUndefined()
})
it('SEC-CONTENT-010 token artwork cannot use a remote URL supplied as branding or address', () => {
  expect(tokenArtwork('https://example.invalid/pixel', 'https://example.invalid/pixel')).toBeUndefined()
  expect(tokenArtwork('CASHCAT', '0x1111111111111111111111111111111111111111')).toBeUndefined()
})
it('SEC-CONTENT-011 inherited artwork keys cannot become image sources', () => {
  for (const key of ['constructor', '__proto__', 'toString']) {
    expect(tokenArtwork(key)).toBeUndefined(); expect(tokenArtwork('CASHCAT', key)).toBeUndefined()
  }
})
it('SEC-PRIVACY-004 catalog persistence strips top-level and nested capabilities', () => {
  const secret = 'fixture-capability-must-not-persist'
  const offer: any = {id:'one', pairId:'pair', apr:20, days:30, active:true, availability:null, recoverySecret:secret,
    token0:{address:'0x1',symbol:'A',decimals:18,session:secret},token1:{address:'0x2',symbol:'B',decimals:18},
    budget:{paused:false,recoverySecret:secret},vaultTvl:{status:'available',usdRaw:'1',key:secret}}
  saveCatalogDisplay([offer])
  expect(localStorage.getItem(cacheKey)).not.toContain(secret); expect(initialCatalog().hasSnapshot).toBe(true)
  expect(initialCatalog().creatorOnline).toBe(false); expect(initialCatalog().loading).toBe(true)
})
it('display persistence enforces its byte and row budget before writing', () => {
  saveCatalogDisplay(new Array(201).fill({}) as any)
  expect(localStorage.getItem(cacheKey)).toBeNull()
})
it('SEC-URL-001 sidebar config cannot create an executable navigation target', async () => {
  vi.stubEnv('VITE_PROTOCOL_APP_URL', 'javascript:alert(document.domain)')
  const { sidebarDestinations } = await import('./sidebarNavigation')
  expect(sidebarDestinations('/').find(row => row.icon === 'pro')!.href).toBe('https://app.saffron.finance/')
})
it('SEC-URL-002 console config cannot embed credentials or executable schemes', async () => {
  vi.stubEnv('VITE_OPERATOR_CONSOLE_HREF', 'https://username:password@example.invalid/console')
  const { operatorConsoleHref } = await import('./operatorConsole')
  expect(operatorConsoleHref).not.toContain('password'); expect(operatorConsoleHref).toContain('/server-operator/')
  expect(safeNavigationHref('data:text/html,test','/safe')).toBe('/safe')
})
it('valid explicit HTTPS and same-origin relative navigation remain usable', () => {
  expect(safeNavigationHref('https://docs.example.invalid/path','/safe')).toBe('https://docs.example.invalid/path')
  expect(safeNavigationHref('/console/','/safe')).toBe('/console/')
})
