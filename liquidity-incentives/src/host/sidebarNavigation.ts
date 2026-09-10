export type SidebarIcon='vaults'|'tokens'|'fixed'|'variable'|'stats'|'audits'|'community'
export interface SidebarDestination {label:string;href:string;icon:SidebarIcon;external?:boolean}
/** Core lifecycle destinations belong to this application. */
export function sidebarDestinations(home:string):SidebarDestination[]{return [
  {label:'Incentives',href:home,icon:'vaults'},
  {label:'My vaults',href:home+'portfolio/vaults',icon:'fixed'},
  {label:'Audits',href:'https://docs.saffron.finance/security/audits',icon:'audits',external:true},
  {label:'Community',href:'https://discord.com/invite/pDXpXKY',icon:'community',external:true},
]}
