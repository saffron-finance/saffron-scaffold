import { describe, expect, it } from 'vitest'

import {
  connectionStatus,
  initialConnection,
  loseConnection,
  receiveConnection,
} from './connection'

const good = { ready: true, error: null }
const bad = { ready: true, error: 'Retrying' }

describe('continuous disconnect grace', () => {
  it('keeps a healthy cold-start queue pending without calling it disconnected', () => {
    let health = initialConnection(0)
    for (let time = 5000; time <= 300_000; time += 5000) {
      health = receiveConnection(health, time, { ready: false, error: null })
      expect(connectionStatus(health, time)).toBe('Connecting')
    }
    health = receiveConnection(health, 301_000, { ready: false, error: 'RPC timeout' })
    health = receiveConnection(health, 322_000, { ready: false, error: 'RPC timeout' })
    expect(connectionStatus(health, 322_000)).toBe('Disconnected')
    expect(connectionStatus(receiveConnection(health, 323_000, good), 323_000)).toBe('Connected')
  })

  it('keeps a known connection green at exactly 20 seconds, then reports failure', () => {
    const connected = receiveConnection(initialConnection(0), 1000, good)
    const lost = loseConnection(connected, 2000)
    expect(connectionStatus(lost, 21_999)).toBe('Connected')
    expect(connectionStatus(lost, 22_000)).toBe('Connected')
    expect(connectionStatus(lost, 22_001)).toBe('Disconnected')
  })

  it('does not extend the guard for repeated EventSource retries or failing RPC statuses', () => {
    const connected = receiveConnection(initialConnection(0), 1000, good)
    const lost = loseConnection(loseConnection(connected, 2000), 20_000)
    expect(connectionStatus(lost, 22_001)).toBe('Disconnected')
    const rpcFailed = receiveConnection(receiveConnection(connected, 2000, bad), 20_000, bad)
    expect(connectionStatus(rpcFailed, 22_001)).toBe('Disconnected')
  })

  it('resets a recovered failure instead of adding separate brief outages together', () => {
    const connected = receiveConnection(initialConnection(0), 1000, good)
    const recovered = receiveConnection(loseConnection(connected, 2000), 21_000, good)
    const lostAgain = loseConnection(recovered, 22_000)
    expect(connectionStatus(lostAgain, 42_000)).toBe('Connected')
    expect(connectionStatus(lostAgain, 42_001)).toBe('Disconnected')
    expect(connectionStatus(receiveConnection(lostAgain, 43_000, good), 43_000)).toBe('Connected')
  })

  it('treats catch-up work as healthy and counts swap/replay messages as transport activity', () => {
    const working = { ...good, catchingUp: true, checkedAt: 0, blockTimestamp: 0 }
    let health = receiveConnection(initialConnection(0), 50_000, working)
    expect(connectionStatus(health, 50_000)).toBe('Connected')
    health = receiveConnection(health, 65_000)
    expect(connectionStatus(health, 85_000)).toBe('Connected')
    expect(connectionStatus(health, 85_001)).toBe('Disconnected')
  })

  it('does not mistake a working SSE transport for a recovered failed RPC scanner', () => {
    let health = receiveConnection(initialConnection(0), 1000, good)
    health = receiveConnection(health, 2000, bad)
    health = receiveConnection(health, 21_000)
    expect(connectionStatus(health, 22_001)).toBe('Disconnected')
  })
})
