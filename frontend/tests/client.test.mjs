import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient, buildQuery } from '../src/services/api.js'
import { createEndpoints, confirmPath } from '../src/services/endpoints.js'

const BASE = 'http://localhost:8000/api/v1'
const envelope = (status, error, headers = {}) => new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', ...headers } })

function recorder(responses) {
  const calls = []
  const queue = [...responses]
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, headers: Object.fromEntries(options.headers.entries()), body: options.body })
      const next = queue.shift()
      return typeof next === 'function' ? next() : next
    },
  }
}

test('authenticated requests carry the token, workspace and idempotency key', async () => {
  const r = recorder([Response.json({ id: 't1' }, { status: 201 })])
  const client = createApiClient({ baseUrl: BASE, fetchImpl: r.fetchImpl, getAccessToken: async () => 'tok', getWorkspaceId: () => 'ws-1' })
  await createEndpoints(client).createTransaction({ type: 'sale' }, 'key-1')
  const [call] = r.calls
  assert.equal(call.url, `${BASE}/transactions`)
  assert.equal(call.method, 'POST')
  assert.equal(call.headers.authorization, 'Bearer tok')
  assert.equal(call.headers['x-workspace-id'], 'ws-1')
  assert.equal(call.headers['idempotency-key'], 'key-1')
  assert.equal(call.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(call.body), { type: 'sale' })
})

test('public calls skip credentials and queries drop empty values', async () => {
  const r = recorder([Response.json({ status: 'healthy' }), Response.json({ items: [] })])
  const client = createApiClient({ baseUrl: BASE, fetchImpl: r.fetchImpl, getAccessToken: async () => 'tok' })
  const endpoints = createEndpoints(client)
  await endpoints.health()
  assert.equal(r.calls[0].headers.authorization, undefined)
  await endpoints.listTransactions({ type: 'sale', search: '', contact_id: null, page: 2 })
  assert.equal(r.calls[1].url, `${BASE}/transactions?type=sale&page=2`)
  assert.equal(buildQuery({ a: 0, b: false }), '?a=0&b=false')
})

test('backend error envelopes keep their message, code, request id and field errors', async () => {
  const r = recorder([envelope(422, { code: 'validation_error', message: 'Some fields are missing or invalid.', details: [{ field: 'amount', message: 'Input should be greater than 0' }, { field: '', message: 'Value error, amount_paid cannot be more than amount.' }], request_id: 'req-9' })])
  const client = createApiClient({ baseUrl: BASE, fetchImpl: r.fetchImpl })
  await assert.rejects(client.request('/transactions', { method: 'POST', json: {} }), (error) => {
    assert.equal(error.status, 422)
    assert.equal(error.code, 'validation_error')
    assert.equal(error.message, 'Some fields are missing or invalid.')
    assert.equal(error.requestId, 'req-9')
    assert.deepEqual(error.fieldErrors, { amount: 'Input should be greater than 0', _form: 'amount_paid cannot be more than amount.' })
    return true
  })
})

test('business rule messages from the backend reach the user', async () => {
  const message = 'This payment (Rs 3,000.00) is more than the amount still due (Rs 2,000.00).'
  const r = recorder([envelope(422, { code: 'business_rule_violation', message, details: { amount_due: '2000.00' } })])
  const client = createApiClient({ baseUrl: BASE, fetchImpl: r.fetchImpl })
  await assert.rejects(client.request('/payments', { method: 'POST', json: {} }), { code: 'business_rule_violation', message })
})

test('rate limits expose Retry-After and AI outages keep their code', async () => {
  const r = recorder([envelope(429, { code: 'rate_limited', message: 'Too many AI requests.' }, { 'Retry-After': '30' }), envelope(503, { code: 'ai_not_configured', message: 'The AI service is not configured.' })])
  const client = createApiClient({ baseUrl: BASE, fetchImpl: r.fetchImpl })
  await assert.rejects(client.request('/ai/assistant'), { status: 429, retryAfter: 30 })
  await assert.rejects(client.request('/ai/assistant'), { status: 503, code: 'ai_not_configured' })
})

test('an expired token is refreshed once and the request retried', async () => {
  let token = 'old'
  const r = recorder([envelope(401, { code: 'token_expired', message: 'Your session has expired. Please log in again.' }), Response.json({ ok: true })])
  const client = createApiClient({ baseUrl: BASE, fetchImpl: r.fetchImpl, getAccessToken: async () => token, refreshSession: async () => { token = 'new'; return true } })
  assert.deepEqual(await client.request('/me'), { ok: true })
  assert.equal(r.calls[0].headers.authorization, 'Bearer old')
  assert.equal(r.calls[1].headers.authorization, 'Bearer new')
})

test('a failed refresh reports the auth error once and does not loop', async () => {
  const seen = []
  const r = recorder([envelope(401, { code: 'authentication_failed', message: 'The access token is invalid.' })])
  const client = createApiClient({ baseUrl: BASE, fetchImpl: r.fetchImpl, getAccessToken: async () => 'bad', refreshSession: async () => false, onAuthError: (error) => seen.push(error.code) })
  await assert.rejects(client.request('/me'), { status: 401 })
  assert.equal(r.calls.length, 1)
  assert.deepEqual(seen, ['authentication_failed'])
})

test('CSV downloads return a blob and a safe filename', async () => {
  const r = recorder([new Response('a,b\n1,2', { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="dukaandiary_2026-10-01_2026-10-10.csv"' } })])
  const client = createApiClient({ baseUrl: BASE, fetchImpl: r.fetchImpl })
  const result = await createEndpoints(client).reportCsv({ period: 'this_month' }, { type: 'sale' })
  assert.equal(r.calls[0].url, `${BASE}/reports/transactions?period=this_month&type=sale&format=csv`)
  assert.equal(result.filename, 'dukaandiary_2026-10-01_2026-10-10.csv')
  assert.equal(await result.blob.text(), 'a,b\n1,2')
})

class FakeXhr {
  constructor(script) { this.script = script; this.headers = {}; this.upload = {} }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(key, value) { this.headers[key.toLowerCase()] = value }
  getResponseHeader() { return null }
  abort() { this.onabort?.() }
  send(body) { this.body = body; queueMicrotask(() => this.script(this)) }
}

test('uploads send multipart data with credentials and report progress', async () => {
  let xhr
  const progress = []
  const client = createApiClient({ baseUrl: BASE, getAccessToken: async () => 'tok', xhrFactory: () => (xhr = new FakeXhr((x) => { x.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 }); x.status = 200; x.responseText = '{"outcome":"unverified"}'; x.onload() })) })
  const file = new Blob(['img'], { type: 'image/png' })
  const result = await createEndpoints(client).analyzeScreenshot(file, { onProgress: (value) => progress.push(value) })
  assert.deepEqual(result, { outcome: 'unverified' })
  assert.equal(xhr.url, `${BASE}/ai/analyze-screenshot`)
  assert.equal(xhr.headers.authorization, 'Bearer tok')
  assert.ok(xhr.body instanceof FormData)
  assert.ok(xhr.body.get('file'))
  assert.deepEqual(progress, [0.5])
})

test('upload failures keep the backend message', async () => {
  const client = createApiClient({ baseUrl: BASE, xhrFactory: () => new FakeXhr((x) => { x.status = 415; x.responseText = JSON.stringify({ error: { code: 'unsupported_file_type', message: 'Only JPEG, PNG or WEBP images are accepted.' } }); x.onload() }) })
  await assert.rejects(createEndpoints(client).analyzeReceipt(new Blob(['x'])), { status: 415, code: 'unsupported_file_type', message: 'Only JPEG, PNG or WEBP images are accepted.' })
  const failing = createApiClient({ baseUrl: BASE, xhrFactory: () => new FakeXhr((x) => x.onerror()) })
  await assert.rejects(createEndpoints(failing).analyzeReceipt(new Blob(['x'])), { code: 'network_error' })
})

test('AI confirm actions are limited to known save routes', () => {
  assert.equal(confirmPath({ method: 'POST', path: '/api/v1/transactions' }), '/transactions')
  assert.equal(confirmPath({ method: 'POST', path: '/api/v1/payments/settle-contact' }), '/payments/settle-contact')
  for (const bad of [{ method: 'POST', path: '/api/v1/demo/seed' }, { method: 'DELETE', path: '/api/v1/transactions' }, { method: 'POST', path: 'https://evil.example/transactions' }, null]) {
    assert.throws(() => confirmPath(bad), { code: 'invalid_response' })
  }
})

test('workspace and idempotency headers are not sent when absent', async () => {
  const r = recorder([Response.json({})])
  const client = createApiClient({ baseUrl: BASE, fetchImpl: r.fetchImpl, getAccessToken: async () => null })
  await client.request('/me')
  assert.equal(r.calls[0].headers['x-workspace-id'], undefined)
  assert.equal(r.calls[0].headers['idempotency-key'], undefined)
  assert.equal(r.calls[0].headers.authorization, undefined)
})
