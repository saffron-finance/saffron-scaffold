/** A display reference, never a replacement for persisted identity. Keep the
 * complete suffix so same-pair programs and historical requests stay distinct.
 * API writes, signed plans and recovery storage always use the original ID. */
export function programReference(id?:string|null):string{
  return id?id.replace(/^campaign-/i,'program-'):'Unavailable'
}

/** Translate legacy server prose only at display boundaries. Never walk or
 * rewrite response objects: their keys, signatures and raw IDs are contracts. */
export function programText(value:unknown):string{
  return String(value??'').replace(/\bcampaign-([\w-]+)/gi,'program-$1')
    .replace(/\bcampaigns\b/gi,word=>word[0]==='C'?'Incentive programs':'incentive programs')
    .replace(/\bcampaign\b/gi,word=>word[0]==='C'?'Incentive program':'incentive program')
}
