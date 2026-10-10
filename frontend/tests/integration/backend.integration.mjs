// Integration tests: the frontend's API client, endpoints and adapters against a REAL backend.
//
// Skipped unless these are set (never point them at production data):
//   INTEGRATION_API_URL     e.g. http://127.0.0.1:8765/api/v1
//   INTEGRATION_JWT_SECRET  the backend's SUPABASE_JWT_SECRET (legacy HS256 test secret)
//   INTEGRATION_ISSUER      the backend's SUPABASE_URL + "/auth/v1"
// Run: npm run test:integration
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { createApiClient } from '../../src/services/api.js'
import { createEndpoints } from '../../src/services/endpoints.js'
import { contactView, ledgerView, pageView, summaryView, transactionCreateBody, transactionView, bankTransactionView, insightsView, reportView, trendsView } from '../../src/services/adapters.js'
import { parseMoney } from '../../src/services/money.js'

const { INTEGRATION_API_URL: BASE, INTEGRATION_JWT_SECRET: SECRET, INTEGRATION_ISSUER: ISSUER } = process.env
const skip = !BASE || !SECRET || !ISSUER ? 'set INTEGRATION_API_URL, INTEGRATION_JWT_SECRET and INTEGRATION_ISSUER' : false

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
function token(sub, { expiresIn = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, aud: 'authenticated', iss: ISSUER, role: 'authenticated', email: `${sub.slice(0, 8)}@test.local`, iat: now, exp: now + expiresIn })}`
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`
}

// Minimal XMLHttpRequest stand-in for Node, built on fetch (uploads only).
class FetchXhr {
  headers = {}
  upload = {}
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(k, v) { this.headers[k] = v }
  getResponseHeader(name) { return this.responseHeaders?.get(name) ?? null }
  abort() { this.onabort?.() }
  async send(body) {
    try {
      const res = await fetch(this.url, { method: this.method, headers: this.headers, body })
      this.status = res.status; this.responseHeaders = res.headers; this.responseText = await res.text(); this.onload()
    } catch { this.onerror() }
  }
}

function userApi(sub = randomUUID(), options = {}) {
  let workspaceId = options.workspaceId ?? null
  const client = createApiClient({ baseUrl: BASE, getAccessToken: async () => options.token ?? token(sub), getWorkspaceId: () => workspaceId, xhrFactory: () => new FetchXhr() })
  return { sub, api: createEndpoints(client), setWorkspace: (id) => { workspaceId = id } }
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date())
const sale = (overrides = {}) => transactionCreateBody({ type: 'sale', amount: '5000', paid: '3000', method: 'cash', description: 'Flour and oil', category: 'Groceries', date: today(), dueDate: '', party: 'Ali', source: 'manual', notes: '', reference: '', ...overrides })

test('authentication: public health, missing token, expired token, first sign-in creates a shop', { skip }, async () => {
  const anonymous = createEndpoints(createApiClient({ baseUrl: BASE }))
  assert.equal((await anonymous.health()).status, 'healthy')
  await assert.rejects(anonymous.me(), { status: 401 })
  const expired = userApi(randomUUID(), { token: token(randomUUID(), { expiresIn: -120 }) })
  await assert.rejects(expired.api.me(), { status: 401, code: 'token_expired' })
  const { api } = userApi()
  const me = await api.me()
  assert.equal(me.workspaces.length, 1)
  assert.equal(me.workspaces[0].role, 'owner')
  assert.equal(me.current_workspace_id, me.workspaces[0].id)
})

test('bookkeeping: partial sale, idempotent retry, repayment is not a new sale', { skip }, async () => {
  const { api } = userApi()
  const key = randomUUID()
  const created = transactionView(await api.createTransaction(sale(), key))
  assert.deepEqual([created.amount, created.paid, created.outstanding, created.status], [500000, 300000, 200000, 'partially_paid'])
  const retried = transactionView(await api.createTransaction(sale(), key))
  assert.equal(retried.id, created.id, 'same Idempotency-Key must return the first record')
  assert.equal((await api.listTransactions({})).total, 1)

  const before = summaryView(await api.dashboardSummary({ period: 'today' }))
  const contacts = (await api.listContacts({ kind: 'customer' })).map(contactView)
  const ali = contacts.find((c) => c.name === 'Ali')
  assert.equal(ali.outstanding, 200000)
  await assert.rejects(api.settleContact({ contact_id: ali.id, amount: '2500.00' }, randomUUID()), (error) => error.status === 422 && error.code === 'business_rule_violation' && /2,000.00/.test(error.message))
  const settlement = await api.settleContact({ contact_id: ali.id, amount: '2000.00', method: 'bank' }, randomUUID())
  assert.equal(parseMoney(settlement.outstanding_after), 0)

  const after = summaryView(await api.dashboardSummary({ period: 'today' }))
  assert.equal(after.sales, before.sales, 'a repayment must not increase sales')
  assert.equal(after.received - before.received, 200000)
  assert.equal(after.balances.receivables, 0)
  const ledger = ledgerView(await api.getContactLedger(ali.id))
  assert.equal(ledger.entries.at(-1).runningBalance, 0)
})

test('bookkeeping: paying a purchase does not count it again; validation and rule errors reach the UI', { skip }, async () => {
  const { api } = userApi()
  const purchase = transactionView(await api.createTransaction(sale({ type: 'purchase', amount: '10000', paid: '4000', party: 'Rashid Wholesale', category: 'Stock' }), randomUUID()))
  const before = summaryView(await api.dashboardSummary({ period: 'today' }))
  await api.createPayment({ transaction_id: purchase.id, amount: '6000.00', method: 'cash' }, randomUUID())
  const after = summaryView(await api.dashboardSummary({ period: 'today' }))
  assert.equal(after.purchases, before.purchases)
  assert.equal(after.expenses, before.expenses)
  assert.equal(after.paid - before.paid, 600000)
  assert.equal(after.balances.payables, 0)

  await assert.rejects(api.createTransaction({ ...sale(), amount: '0.00' }, randomUUID()), (error) => error.code === 'validation_error' && Boolean(error.fieldErrors.amount))
  await assert.rejects(api.updateTransaction(purchase.id, { amount: '5000.00' }), (error) => error.status === 422 && error.message.length > 10)
  await assert.rejects(api.createTransaction(sale({ paid: '1000', party: '' }), randomUUID()), (error) => error.status === 422)
})

test('void removes a record from totals and lists', { skip }, async () => {
  const { api } = userApi()
  const row = transactionView(await api.createTransaction(sale({ type: 'expense', amount: '1200', paid: '1200', party: '', category: 'Utilities', description: 'Bijli bill' }), randomUUID()))
  assert.equal(summaryView(await api.dashboardSummary({ period: 'today' })).expenses, 120000)
  assert.equal(await api.voidTransaction(row.id), null)
  assert.equal(summaryView(await api.dashboardSummary({ period: 'today' })).expenses, 0)
  assert.equal((await api.listTransactions({})).total, 0)
  await assert.rejects(api.getTransaction(row.id), { status: 404 })
})

test('workspace isolation: another user cannot read or select a shop', { skip }, async () => {
  const owner = userApi()
  const other = userApi()
  const ownerShop = (await owner.api.me()).current_workspace_id
  const record = transactionView(await owner.api.createTransaction(sale(), randomUUID()))
  await other.api.me()
  await assert.rejects(other.api.getTransaction(record.id), { status: 404 })
  other.setWorkspace(ownerShop)
  await assert.rejects(other.api.listTransactions({}), { status: 403 })
  await assert.rejects(other.api.dashboardSummary({ period: 'today' }), { status: 403 })
})

test('dashboard, trends, reports and CSV export parse with the adapters', { skip }, async () => {
  const { api } = userApi()
  await api.createTransaction(sale(), randomUUID())
  const trends = trendsView(await api.dashboardTrends({ period: 'this_month' }, 'day'))
  assert.ok(trends.points.length >= 1)
  const report = reportView(await api.reportSummary({ period: 'this_month' }))
  assert.equal(report.sales, 500000)
  assert.ok(report.topCustomers.length === 1 && parseMoney(String(report.topCustomers[0].outstanding)) === 200000)
  const rows = pageView(await api.reportTransactions({ period: 'this_month' }, { type: 'sale' }), transactionView)
  assert.equal(rows.total, 1)
  const csv = await api.reportCsv({ period: 'this_month' }, {})
  assert.match(csv.filename, /^dukaandiary_.*\.csv$/)
  assert.match(await csv.blob.text(), /Flour and oil/)
  await assert.rejects(api.dashboardSummary({ period: 'custom', date_from: '2026-10-10', date_to: '2026-10-01' }), { status: 400 })
})

test('Dummy Bank: synthetic data, completed-only and duplicate-safe imports', { skip }, async () => {
  const { api } = userApi()
  const [account] = await api.bankAccounts()
  assert.equal(account.is_synthetic, true)
  const created = transactionView(await api.createTransaction(sale({ paid: '0', party: 'Bilal' }), randomUUID()))
  const incoming = bankTransactionView(await api.simulateIncoming({ amount: '2000.00', counterparty_name: 'Bilal', direction: 'in', status: 'completed' }))
  const pending = bankTransactionView(await api.simulateIncoming({ amount: '1000.00', counterparty_name: 'Bilal', direction: 'in', status: 'pending' }))
  await assert.rejects(api.importBankTransaction(pending.id, { mode: 'settle_transaction', transaction_id: created.id }), (error) => error.status >= 400 && error.status < 500)
  const result = await api.importBankTransaction(incoming.id, { mode: 'settle_transaction', transaction_id: created.id })
  assert.equal(result.created_transaction_id, null, 'settling must not create a new sale')
  await assert.rejects(api.importBankTransaction(incoming.id, { mode: 'settle_transaction', transaction_id: created.id }), { status: 409 })
  const after = transactionView(await api.getTransaction(created.id))
  assert.equal(after.paid, 200000)
  const list = (await api.bankTransactions({ not_imported_only: true })).map(bankTransactionView)
  assert.ok(!list.some((row) => row.id === incoming.id))
  await assert.rejects(api.voidTransaction(created.id), (error) => error.status === 409 || error.status === 422)
})

test('AI routes report unavailability honestly; assistant and insights still use real figures', { skip }, async () => {
  const { api } = userApi()
  await api.createTransaction(sale({ type: 'expense', amount: '4200', paid: '4200', party: '', category: 'Utilities', description: 'Bijli bill' }), randomUUID())
  await assert.rejects(api.parseTransaction({ text: 'Ali ko 5000 ka saman becha' }), (error) => error.status === 503 && error.code.startsWith('ai_'))
  const answer = await api.askAssistant('How much did I spend this month?')
  assert.equal(typeof answer.answer, 'string')
  assert.equal(answer.ai_generated, false)
  const insights = insightsView(await api.expenseInsights({ period: 'this_month' }))
  assert.equal(insights.totalCurrent, 420000)
  assert.equal(insights.aiGenerated, false)
  const png = new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')], { type: 'image/png' })
  await assert.rejects(api.analyzeScreenshot(png), (error) => error.status === 503)
  await assert.rejects(api.analyzeReceipt(png), (error) => error.status === 503)
})

test('demo seed is labelled and removable', { skip }, async () => {
  const { api } = userApi()
  await api.seedDemo()
  const summary = summaryView(await api.dashboardSummary({ period: 'all_time' }))
  assert.equal(summary.hasDemoData, true)
  assert.ok(summary.recent.every((row) => row.isDemo))
  await api.resetDemo()
  assert.equal(summaryView(await api.dashboardSummary({ period: 'all_time' })).hasDemoData, false)
})
