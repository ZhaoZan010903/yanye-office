import assert from 'node:assert/strict'
import test from 'node:test'
import { StagedWrites } from '../src/desktop/staged-writes.ts'

test('asynchronous IPC retries a rejected revision before newer edits and close', async () => {
  let first = true
  const calls = []
  const queue = new StagedWrites(async revision => {
    calls.push(revision)
    if (first) { first = false; throw Error('disk full') }
  })
  const stage = queue.stage(12)
  const next = queue.stage(13)
  await Promise.all([stage, next].map(work => assert.rejects(work, /disk full/)))
  await queue.drain()
  assert.deepEqual(calls, [12, 12, 13])
  await Promise.all([queue.drain(), queue.stage(14)])
  assert.deepEqual(calls, [12, 12, 13, 14])
})
