import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LiveProvider from '../src/live/LiveProvider'
import LiveApp from '../src/live/LiveApp'

const BASE = 'http://api.test/api/v1'
const config = { mode: 'live', apiBaseUrl: BASE, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' }
const ME = { user: { id: 'u1', email: 'ahmed@shop.pk' }, current_workspace_id: 'w1', workspaces: [{ id: 'w1', name: 'Bismillah Store', currency: 'PKR', timezone: 'Asia/Karachi', role: 'owner' }] }
const period = { name: 'today', label: 'Today', date_from: '2026-10-10', date_to: '2026-10-10' }
const SUMMARY = {
  period, figures: { total_sales: '10300.00', total_purchases: '0.00', total_expenses: '4200.00', money_received: '5850.00', money_paid: '4200.00', net_cash_flow: '1650.00', sales_count: 3, purchases_count: 0, expenses_count: 1 },
  balances: { as_of: '2026-10-10', receivables: '4450.00', payables: '0.00', overdue_receivables: '0.00', overdue_payables: '0.00', open_receivable_items: 2, open_payable_items: 0, overdue_receivable_items: 0, overdue_payable_items: 0 },
  received_breakdown: {}, recent_transactions: [], has_demo_data: false, definitions: { net_cash_flow: 'Not cash in hand.', profit: 'Profit is not shown.' },
}
const TXN = { id: 't9', type: 'sale', category: 'groceries', description: 'Flour sale', notes: null, amount: '1250.50', currency: 'PKR', transaction_date: '2026-10-10', due_date: null, contact: { id: 'c1', name: 'Ali', kind: 'customer' }, source: 'manual', receipt_ref: null, is_demo: false, amount_paid: '250.50', amount_pending: '0.00', outstanding: '1000.00', settlement_status: 'partially_paid', is_overdue: false, created_at: 'x', updated_at: 'x', payments: [] }

function fakeSupabase(session) {
  let listener = () => {}
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: (fn) => { listener = fn; return { data: { subscription: { unsubscribe() {} } } } },
      refreshSession: vi.fn(async () => ({ data: { session: null }, error: { message: 'expired' } })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
      signOut: vi.fn(async () => { session = null; listener('SIGNED_OUT', null); return { error: null } }),
    },
  }
}
const SESSION = { access_token: 'tok', user: { id: 'u1', email: 'ahmed@shop.pk' } }

/** Fake backend: routes are [method, pathRegex, handler(request) => Response]. Records calls. */
function fakeBackend(routes) {
  const calls = []
  const fetchImpl = async (url, options) => {
    const { pathname, searchParams } = new URL(url)
    const path = pathname.replace('/api/v1', '')
    const call = { method: options.method ?? 'GET', path, query: Object.fromEntries(searchParams), headers: Object.fromEntries(options.headers.entries()), body: options.body ? JSON.parse(options.body) : undefined }
    calls.push(call)
    const route = routes.find(([method, pattern]) => method === call.method && pattern.test(path))
    if (!route) return Response.json({ error: { code: 'not_found', message: `No fake route for ${call.method} ${path}` } }, { status: 404 })
    return route[2](call)
  }
  return { calls, fetchImpl }
}
const commonRoutes = [
  ['GET', /^\/me$/, () => Response.json(ME)],
  ['GET', /^\/dashboard\/summary$/, () => Response.json(SUMMARY)],
  ['GET', /^\/dashboard\/trends$/, () => Response.json({ period, granularity: 'day', points: [] })],
  ['GET', /^\/dashboard\/expense-breakdown$/, () => Response.json({ period, include_purchases: false, total: '4200.00', categories: [{ category: 'utilities', total: '4200.00', count: 1, share_percent: 100 }] })],
  ['GET', /^\/contacts$/, () => Response.json([])],
]

function renderLive({ session = SESSION, routes = [], supabase = fakeSupabase(session), hash = '#/' } = {}) {
  window.location.hash = hash
  const backend = fakeBackend([...routes, ...commonRoutes])
  render(<LiveProvider config={config} supabase={supabase} fetchImpl={backend.fetchImpl}><LiveApp /></LiveProvider>)
  return { ...backend, supabase }
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  localStorage.clear()
})
afterEach(() => { cleanup(); window.location.hash = '' })

test('signed-out users see sign-in, and credentials go only to Supabase', async () => {
  const user = userEvent.setup()
  const { calls, supabase } = renderLive({ session: null })
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
  await user.type(screen.getByLabelText('Email'), 'ahmed@shop.pk')
  await user.type(screen.getByLabelText('Password'), 'secret-pass')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ahmed@shop.pk', password: 'secret-pass' })
  expect(calls).toHaveLength(0)
})

test('dashboard shows backend figures with the token and workspace header', { timeout: 30000 }, async () => {
  const { calls } = renderLive()
  expect((await screen.findAllByText('PKR 10,300', {}, { timeout: 20000 })).length).toBeGreaterThan(0)
  expect(screen.getAllByText('PKR 5,850').length).toBeGreaterThan(0)
  expect(screen.getByText(/Owed to you as of 2026-10-10/)).toBeTruthy()
  const summary = calls.find((c) => c.path === '/dashboard/summary')
  expect(summary.query.period).toBe('today')
  expect(summary.headers.authorization).toBe('Bearer tok')
  expect(summary.headers['x-workspace-id']).toBe('w1')
})

test('a failed summary shows the backend error and never falls back to sample numbers', { timeout: 30000 }, async () => {
  renderLive({ routes: [['GET', /^\/dashboard\/summary$/, () => Response.json({ error: { code: 'database_unavailable', message: 'The database is not reachable right now. Try again shortly.', request_id: 'r1' } }, { status: 503 })]] })
  expect(await screen.findByText('The database is not reachable right now. Try again shortly.', {}, { timeout: 20000 })).toBeTruthy()
  expect(screen.getByText('Reference: r1')).toBeTruthy()
  expect(screen.queryByText(/PKR 10,300/)).toBeNull()
})

test('an expired session that cannot be refreshed signs the user out with a notice', async () => {
  const supabase = fakeSupabase(SESSION)
  renderLive({ supabase, routes: [['GET', /^\/me$/, () => Response.json({ error: { code: 'token_expired', message: 'Your session has expired. Please log in again.' } }, { status: 401 })]] })
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
  expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1)
  expect(supabase.auth.signOut).toHaveBeenCalled()
  expect(screen.getByText('Your session expired. Please sign in again.')).toBeTruthy()
})

test('a new transaction is saved only on confirmation, retried with the same Idempotency-Key', async () => {
  const user = userEvent.setup()
  let attempts = 0
  const { calls } = renderLive({ hash: '#/transactions/new?type=sale', routes: [
    ['POST', /^\/transactions$/, () => (++attempts === 1 ? Promise.reject(new TypeError('Failed to fetch')) : Response.json(TXN, { status: 201 }))],
    ['GET', /^\/transactions\/t9$/, () => Response.json(TXN)],
  ] })
  await user.type(await screen.findByLabelText('Amount (PKR)'), '1250.50')
  await user.clear(screen.getByLabelText('Amount paid now (PKR)'))
  await user.type(screen.getByLabelText('Amount paid now (PKR)'), '250.50')
  await user.type(screen.getByLabelText('Description'), 'Flour sale')
  await user.type(screen.getByLabelText('Customer'), 'Ali')
  await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
  await user.click(screen.getByRole('button', { name: 'Review transaction' }))
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Confirm and save' }))
  expect(await screen.findByText('Cannot reach the server. Check your connection and try again.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Confirm and save' }))
  expect(await screen.findByText('Transaction saved.')).toBeTruthy()
  const posts = calls.filter((c) => c.method === 'POST' && c.path === '/transactions')
  expect(posts).toHaveLength(2)
  expect(posts[0].headers['idempotency-key']).toBeTruthy()
  expect(posts[1].headers['idempotency-key']).toBe(posts[0].headers['idempotency-key'])
  expect(posts[0].body).toMatchObject({ type: 'sale', amount: '1250.50', amount_paid: '250.50', payment_method: 'cash', contact_name: 'Ali', source: 'manual' })
})

test('backend field errors return the user to the form next to the field', async () => {
  const user = userEvent.setup()
  renderLive({ hash: '#/transactions/new?type=expense', routes: [
    ['POST', /^\/transactions$/, () => Response.json({ error: { code: 'validation_error', message: 'Some fields are missing or invalid.', details: [{ field: 'transaction_date', message: 'Transaction dates cannot be in the future.' }] } }, { status: 422 })],
  ] })
  await user.type(await screen.findByLabelText('Amount (PKR)'), '500')
  await user.clear(screen.getByLabelText('Amount paid now (PKR)'))
  await user.type(screen.getByLabelText('Amount paid now (PKR)'), '500')
  await user.type(screen.getByLabelText('Description'), 'Bijli')
  await user.selectOptions(screen.getByLabelText('Category'), 'Utilities')
  await user.click(screen.getByRole('button', { name: 'Review transaction' }))
  await user.click(screen.getByRole('button', { name: 'Confirm and save' }))
  expect(await screen.findByText('Transaction dates cannot be in the future.')).toBeTruthy()
  expect(screen.getByLabelText('Date').getAttribute('aria-invalid')).toBe('true')
})

test('AI clarification sends the original sentence, and a draft is never shown as saved', async () => {
  const user = userEvent.setup()
  const draft = { status: 'ready_to_confirm', intent: 'new_transaction', transaction_draft: { type: 'sale', amount: '5000.00', amount_paid: '3000.00', amount_due: '2000.00', payment_method: 'cash', category: 'groceries', description: 'Goods', contact_name: 'Ali', contact_id: null, contact_match: 'new', similar_contacts: [], transaction_date: '2026-10-10', due_date: null, currency: 'PKR' }, payment_draft: null, missing_fields: [], warnings: [], assumptions: ['Date set to today.'], clarification_question: null, language_detected: 'roman_urdu', confirm: { method: 'POST', path: '/api/v1/transactions', body: {} }, saved: false }
  const { calls } = renderLive({ hash: '#/ai-entry', routes: [
    ['POST', /^\/ai\/parse-transaction$/, (call) => Response.json(call.body.previous_text ? draft : { ...draft, status: 'needs_clarification', transaction_draft: null, missing_fields: ['amount_paid'], clarification_question: 'Kitne paise mile?', confirm: null })],
  ] })
  await user.type(await screen.findByLabelText('Describe the transaction'), 'Ali ko 5000 ka saman becha')
  await user.click(screen.getByRole('button', { name: 'Create draft' }))
  expect(await screen.findByText('Kitne paise mile?')).toBeTruthy()
  await user.type(screen.getByLabelText('Your answer'), '3000 cash')
  await user.click(screen.getByRole('button', { name: 'Send answer' }))
  expect(await screen.findByText('Draft · not saved')).toBeTruthy()
  const parses = calls.filter((c) => c.path === '/ai/parse-transaction')
  expect(parses[1].body).toEqual({ text: '3000 cash', previous_text: 'Ali ko 5000 ka saman becha', input_mode: 'typed' })
  expect(calls.some((c) => c.method === 'POST' && c.path === '/transactions')).toBe(false)
  await user.click(screen.getByRole('button', { name: /Review and edit draft/ }))
  expect(await screen.findByText(/It has not been saved/)).toBeTruthy()
  expect(screen.getByLabelText('Amount (PKR)').value).toBe('5000')
})

test('when AI is unavailable the typed text is kept and manual entry is offered', async () => {
  const user = userEvent.setup()
  renderLive({ hash: '#/ai-entry', routes: [['POST', /^\/ai\/parse-transaction$/, () => Response.json({ error: { code: 'ai_not_configured', message: 'The AI service is not configured on the server.' } }, { status: 503 })]] })
  await user.type(await screen.findByLabelText('Describe the transaction'), 'Bijli ka bill 4200')
  await user.click(screen.getByRole('button', { name: 'Create draft' }))
  expect(await screen.findByText('The AI helper is unavailable right now.')).toBeTruthy()
  expect(screen.getByLabelText('Describe the transaction').value).toBe('Bijli ka bill 4200')
  expect(screen.getByRole('link', { name: 'enter the transaction manually' })).toBeTruthy()
})

test('void asks for confirmation and shows the backend refusal', async () => {
  const user = userEvent.setup()
  const { calls } = renderLive({ hash: '#/transactions', routes: [
    ['GET', /^\/transactions$/, () => Response.json({ items: [TXN], total: 1, page: 1, page_size: 20, has_more: false })],
    ['DELETE', /^\/transactions\/t9$/, () => Response.json({ error: { code: 'record_locked', message: 'This record is linked to a Dummy Bank import and cannot be voided.' } }, { status: 409 })],
  ] })
  await user.click(await screen.findByRole('button', { name: 'Void Flour sale' }))
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Void transaction' }))
  expect(await screen.findByText('This record is linked to a Dummy Bank import and cannot be voided.')).toBeTruthy()
})
