import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient } from '../src/services/api.js'

test('missing configuration fails without contacting a server', async () => {
  const client = createApiClient({ fetchImpl: () => assert.fail('unexpected request') })
  await assert.rejects(client.request('/health'), { code: 'not_configured' })
})

test('joins the base URL and preserves caller headers', async () => {
  const client = createApiClient({ baseUrl: 'http://localhost:8000/', fetchImpl: async (url, options) => {
    assert.equal(url, 'http://localhost:8000/health')
    assert.equal(options.headers.get('Authorization'), 'Bearer test-token')
    assert.equal(options.headers.get('Accept'), 'application/json')
    return Response.json({ status: 'healthy' })
  } })
  assert.deepEqual(await client.request('/health', { headers: { Authorization: 'Bearer test-token' } }), { status: 'healthy' })
})

test('HTTP errors retain status without exposing raw server details', async () => {
  const client = createApiClient({ baseUrl: 'http://localhost:8000', fetchImpl: async () => new Response('private server details', { status: 403 }) })
  await assert.rejects(client.request('/health'), { status: 403, code: 'http_error', message: 'You do not have access to this information.' })
})

test('malformed success bodies produce a response error', async () => {
  const client = createApiClient({ baseUrl: 'http://localhost:8000', fetchImpl: async () => new Response('<html>error</html>') })
  await assert.rejects(client.request('/health'), { code: 'invalid_response' })
})

test('204 responses do not require JSON', async () => {
  const client = createApiClient({ baseUrl: 'http://localhost:8000', fetchImpl: async () => new Response(null, { status: 204 }) })
  assert.equal(await client.request('/record'), null)
})

const pendingFetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(new Error('aborted'))
  else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
})

test('timeouts and caller cancellation remain distinguishable', async () => {
  const client = createApiClient({ baseUrl: 'http://localhost:8000', timeoutMs: 5, fetchImpl: pendingFetch })
  await assert.rejects(client.request('/health'), { code: 'timeout' })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(client.request('/health', { signal: controller.signal }), { code: 'cancelled' })
})

test('network failure produces an actionable error', async () => {
  const client = createApiClient({ baseUrl: 'http://localhost:8000', fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
  await assert.rejects(client.request('/health'), { code: 'network_error' })
})
