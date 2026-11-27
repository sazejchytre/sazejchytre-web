import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { disposableTarget } from './disposable-database.ts'

const local = 'postgresql://tester:test@127.0.0.1:15433/sc_fixture_example'

const original = process.env
beforeEach(() => {
  process.env = { ...original, NODE_ENV: 'test' }
  delete process.env.PGOPTIONS
})
afterEach(() => {
  process.env = original
})

test('requires an explicit local fixture target before opening a connection', () => {
  assert.equal(
    disposableTarget(local + '?sslmode=disable').hostname,
    '127.0.0.1',
  )
  for (const url of [
    undefined,
    '',
    'invalid',
    local.replace('127.0.0.1', 'example.invalid'),
    local.replace(':15433', ''),
    local.replace('tester:test@', ''),
    local.replace('sc_fixture_example', 'app'),
    local + '?host=example.invalid',
    local + '?sslmode=disable&dbname=app',
    local + '?options=test',
    local + '#ignored',
  ]) {
    assert.throws(() => disposableTarget(url), /explicit loopback URL/)
  }
})

test('refuses production even with a local fixture URL', () => {
  process.env = { ...process.env, NODE_ENV: 'production' }
  assert.throws(() => disposableTarget(local), /local test environment/)
})
