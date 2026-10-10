import test from 'node:test'
import assert from 'node:assert/strict'
import { readConfig } from '../src/config.js'

const live = { VITE_API_BASE_URL: 'http://localhost:8000/api/v1/', VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_123' }
const jwt = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`

test('complete live settings select live mode and normalise the base URL', () => {
  const config = readConfig(live)
  assert.equal(config.mode, 'live')
  assert.equal(config.apiBaseUrl, 'http://localhost:8000/api/v1')
  assert.deepEqual(config.problems, [])
})

test('an empty development configuration opens the labelled demo workspace', () => {
  assert.equal(readConfig({ DEV: true }).mode, 'demo')
})

test('production builds never fall back to demo data silently', () => {
  const config = readConfig({ PROD: true })
  assert.equal(config.mode, 'misconfigured')
  assert.ok(config.problems.length >= 3)
})

test('demo mode must be chosen explicitly when other settings exist', () => {
  assert.equal(readConfig({ ...live, VITE_APP_MODE: 'demo' }).mode, 'demo')
  assert.equal(readConfig({ VITE_API_BASE_URL: 'http://localhost:8000/api/v1', DEV: true }).mode, 'misconfigured')
})

test('a base URL without the /api/v1 prefix is rejected with guidance', () => {
  const config = readConfig({ ...live, VITE_API_BASE_URL: 'http://localhost:8000' })
  assert.equal(config.mode, 'misconfigured')
  assert.match(config.problems.join(' '), /\/api\/v1/)
})

test('secret and service-role keys are refused and not kept in config', () => {
  for (const key of ['sb_secret_abc', jwt({ role: 'service_role' })]) {
    const config = readConfig({ ...live, VITE_SUPABASE_ANON_KEY: key })
    assert.equal(config.mode, 'misconfigured')
    assert.equal(config.supabaseAnonKey, '')
    assert.match(config.problems.join(' '), /rotate/)
  }
  assert.equal(readConfig({ ...live, VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon' }) }).mode, 'live')
})
