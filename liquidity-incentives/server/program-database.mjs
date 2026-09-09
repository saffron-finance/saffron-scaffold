import { canonicalIncentive } from '../shared/vault-request.mjs'

const pair = (row) => ({ id: row.id, revision: row.revision, chainId: row.chain_id, pool: row.pool_address,
  feeTier: row.fee_tier, token0: row.token0, token1: row.token1, active: row.active })
const program = (row) => ({ id: row.id, revision: row.revision, pairId: row.pair_id,
  apr: Number(row.apr_percent), days: row.duration_days, capacityUsd: Number(row.capacity_usd),
  sortOrder: row.sort_order, isNew: row.is_new, active: row.active })
const conflict = () => Object.assign(new Error('This row changed. Reload the catalog before saving.'), { status: 409 })
const sameToken = (a, b) => a.address.toLowerCase() === b.address.toLowerCase() && a.symbol === b.symbol && a.decimals === b.decimals

export function createProgramDatabase(pool, ready) {
  return {
    async catalog(admin = false) {
      await ready()
      // Both tables are read in one statement/snapshot, including concurrent pair edits.
      const { rows } = await pool.query(`SELECT
        (SELECT COALESCE(jsonb_agg(p ORDER BY id),'[]') FROM liqifi.incentive_pairs p) AS pairs,
        (SELECT COALESCE(jsonb_agg(p ORDER BY sort_order,id),'[]') FROM liqifi.incentive_programs p) AS programs`)
      const pairs = rows[0].pairs.map(pair), programs = rows[0].programs.map(program)
      if (admin) return { pairs, programs }
      const offers = programs.filter(p => p.active).flatMap(p => {
        const selected = pairs.find(row => row.id === p.pairId && row.active)
        return selected ? [{ ...selected, ...p, pairId: selected.id }] : []
      })
      return { offers }
    },
    async savePair(value, wallet) {
      await ready()
      const values = [value.id, value.chainId, value.pool, value.feeTier, value.token0, value.token1, value.active, wallet]
      const result = value.revision === 0
        ? await pool.query(`INSERT INTO liqifi.incentive_pairs (id,chain_id,pool_address,fee_tier,token0,token1,active,updated_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING *`, values)
        : await pool.query(`UPDATE liqifi.incentive_pairs SET chain_id=$2,pool_address=$3,fee_tier=$4,token0=$5,token1=$6,
            active=$7,updated_by=$8,updated_at=NOW(),revision=revision+1 WHERE id=$1 AND revision=$9 RETURNING *`, [...values, value.revision])
      if (!result.rows.length) throw conflict()
      return pair(result.rows[0])
    },
    async saveProgram(value, wallet) {
      await ready()
      const values = [value.id, value.pairId, value.apr, value.days, value.capacityUsd, value.sortOrder, value.isNew, value.active, wallet]
      let result
      try {
        result = value.revision === 0
          ? await pool.query(`INSERT INTO liqifi.incentive_programs (id,pair_id,apr_percent,duration_days,capacity_usd,sort_order,is_new,active,updated_by)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING RETURNING *`, values)
          : await pool.query(`UPDATE liqifi.incentive_programs SET pair_id=$2,apr_percent=$3,duration_days=$4,capacity_usd=$5,
              sort_order=$6,is_new=$7,active=$8,updated_by=$9,updated_at=NOW(),revision=revision+1 WHERE id=$1 AND revision=$10 RETURNING *`, [...values, value.revision])
      } catch (error) {
        if (error.code === '23503') throw Object.assign(new Error('Choose an existing pair.'), { status: 400 })
        throw error
      }
      if (!result.rows.length) throw conflict()
      return program(result.rows[0])
    },
    async assertActiveProgram(terms) {
      const { offers } = await this.catalog()
      const offer = offers.find(row => row.id === terms.id)
      const normalized = canonicalIncentive(terms)
      if (!offer || offer.chainId !== normalized.chainId || offer.pool !== normalized.poolAddress
        || offer.feeTier !== normalized.feeTier || offer.apr !== normalized.aprPercent
        || offer.days !== normalized.durationDays || offer.capacityUsd !== normalized.capacityUsd
        || !sameToken(offer.token0, normalized.token0) || !sameToken(offer.token1, normalized.token1)) {
        throw Object.assign(new Error('This program changed or is paused. Refresh offers before paying.'), { status: 409 })
      }
    },
    async quoteToken(address) {
      const { offers } = await this.catalog()
      return offers.find(offer => offer.token1.address.toLowerCase() === address.toLowerCase())?.token1 ?? null
    },
  }
}
