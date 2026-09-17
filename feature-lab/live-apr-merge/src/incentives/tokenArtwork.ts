import cashcatLogo from './assets/cashcat.jpg'
import ethLogo from './assets/eth.svg'


/** Resolve only bundled/local artwork; cache data never supplies an image URL. */
export function tokenArtwork(symbol:string,address?:string,compact=false):string|undefined {
  // The approved phone pair header uses the existing cutout artwork. Token
  // identity still comes from its address; other surfaces retain their image.
  const known: Record<string, string> = {
    '0x020bfc650a365f8bb26819deaabf3e21291018b4': compact ? `${import.meta.env.BASE_URL}cashcat.png` : cashcatLogo,
    '0x0bd7d308f8e1639fab988df18a8011f41eacad73': ethLogo,
    // Catalog cards pass addresses; USDG must not depend on the legacy symbol lookup.
    '0x5fc5360d0400a0fd4f2af552add042d716f1d168': `${import.meta.env.BASE_URL}usdg.png`,
  }
  const legacy: Record<string, string> = { CASHCAT: 'cashcat.png', ETH: 'eth.svg', USDC: 'usdc.svg', USDG: 'usdg.png' }
  return  address ? Object.hasOwn(known,address.toLowerCase()) ? known[address.toLowerCase()] : undefined : Object.hasOwn(legacy, symbol) ? `${import.meta.env.BASE_URL}${legacy[symbol]}` : undefined
}
