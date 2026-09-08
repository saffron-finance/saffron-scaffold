import pg from 'pg'
import { randomBytes } from 'node:crypto'
import { createRequestDatabase } from '../server/request-database.mjs'

/** Each test owns a new disposable PostgreSQL database, never the hosted database. */
export async function postgresFixture(options = {}) {
  const connection = { host: process.env.SAFFRON_TEST_DB_HOST || '/var/run/postgresql',
    user: process.env.SAFFRON_TEST_DB_USER || 'saffron_incentives_test', options: '-c timezone=UTC' }
  const name = 'liqifi_test_' + randomBytes(8).toString('hex')
  const control = new pg.Pool({ ...connection, database: 'postgres', max: 1 })
  await control.query(`CREATE DATABASE "${name}"`)
  const database = createRequestDatabase({ ...options, connection: { ...connection, database: name } })
  try { await database.ready }
  catch (error) { await database.close(); await control.query(`DROP DATABASE "${name}"`); await control.end(); throw error }
  return { database,
    records: async () => (await database.pool.query('SELECT payload FROM liqifi.request_payments ORDER BY created_at')).rows.map((r) => r.payload),
    async close() {
      await database.close()
      // This exact unpredictable name was created above by this fixture only.
      await control.query(`DROP DATABASE "${name}"`)
      await control.end()
    },
  }
}
