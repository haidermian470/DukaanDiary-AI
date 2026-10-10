import test from 'node:test'
import assert from 'node:assert/strict'
import {
  periodQuery, dateRangeQuery, transactionView, summaryView, contactView, ledgerView, methodToApi, methodLabel,
  transactionCreateBody, transactionUpdateBody, transactionFormValues, insightsView, bankTransactionView, categoryLabel,
} from '../src/services/adapters.js'

const apiTransaction = {
  id: 't1', type: 'sale', category: 'groceries', description: 'Monthly grocery khata', notes: null, amount: '5000.00', currency: 'PKR',
  transaction_date: '2026-10-10', due_date: '2026-10-20', contact: { id: 'c1', name: 'Ali Raza', kind: 'customer' }, source: 'manual',
  receipt_ref: null, is_demo: false, amount_paid: '2000.00', amount_pending: '500.00', outstanding: '3000.00', settlement_status: 'partially_paid',
  is_overdue: false, created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-10T10:00:00Z',
}

test('periods map to backend names and invalid custom ranges are refused', () => {
  assert.deepEqual(periodQuery('today'), { period: 'today' })
  assert.deepEqual(periodQuery('week'), { period: 'this_week' })
  assert.deepEqual(periodQuery('month'), { period: 'this_month' })
  assert.deepEqual(periodQuery('all'), { period: 'all_time' })
  assert.deepEqual(periodQuery('custom', { start: '2026-10-01', end: '2026-10-10' }), { period: 'custom', date_from: '2026-10-01', date_to: '2026-10-10' })
  assert.equal(periodQuery('custom', { start: '2026-10-10', end: '2026-10-01' }), null)
  assert.equal(periodQuery('custom', { start: '', end: '2026-10-01' }), null)
  assert.throws(() => periodQuery('fortnight'))
})

test('list date filters use Monday week starts and month starts', () => {
  assert.deepEqual(dateRangeQuery('week', null, '2026-10-10'), { date_from: '2026-10-05', date_to: '2026-10-10' })
  assert.deepEqual(dateRangeQuery('month', null, '2026-10-10'), { date_from: '2026-10-01', date_to: '2026-10-10' })
  assert.deepEqual(dateRangeQuery('all', null, '2026-10-10'), {})
})

test('API transactions become paisa view rows with backend-calculated balances', () => {
  const view = transactionView(apiTransaction)
  assert.equal(view.amount, 500000)
  assert.equal(view.paid, 200000)
  assert.equal(view.pending, 50000)
  assert.equal(view.outstanding, 300000)
  assert.equal(view.party, 'Ali Raza')
  assert.equal(view.status, 'partially_paid')
  assert.equal(view.payments, undefined)
})

test('malformed money from the server is rejected rather than displayed', () => {
  assert.throws(() => transactionView({ ...apiTransaction, amount: 5000.1 }), { code: 'invalid_money' })
})

test('dashboard summary keeps cash movement separate from sales and expenses', () => {
  const view = summaryView({
    period: { name: 'today', label: 'Today', date_from: '2026-10-10', date_to: '2026-10-10' },
    figures: { total_sales: '10300.00', total_purchases: '19500.00', total_expenses: '4200.00', money_received: '5850.00', money_paid: '11700.00', net_cash_flow: '-5850.00', sales_count: 3, purchases_count: 1, expenses_count: 1 },
    balances: { as_of: '2026-10-10', receivables: '4450.00', payables: '12000.00', overdue_receivables: '0.00', overdue_payables: '0.00', open_receivable_items: 2, open_payable_items: 1, overdue_receivable_items: 0, overdue_payable_items: 0 },
    received_breakdown: { cash: '3850.00', bank: '2000.00' }, recent_transactions: [apiTransaction], has_demo_data: true, definitions: { profit: 'Not shown.' },
  })
  assert.equal(view.sales, 1030000)
  assert.equal(view.received, 585000)
  assert.equal(view.netCashFlow, -585000)
  assert.equal(view.balances.receivables, 445000)
  assert.deepEqual(view.receivedBreakdown, [{ key: 'cash', amount: 385000 }, { key: 'bank', amount: 200000 }])
  assert.equal(view.recent[0].id, 't1')
  assert.equal(view.hasDemoData, true)
})

test('contacts and ledgers convert balances and running totals', () => {
  const contact = { id: 'c1', kind: 'customer', name: 'Ali', phone: null, notes: null, is_demo: false, created_at: 'x', total_billed: '5000.00', total_settled: '2000.00', outstanding: '3000.00', overdue_amount: '0.00', is_overdue: false, earliest_due_date: null, open_items: 1, advance_balance: '0.00' }
  assert.equal(contactView(contact).outstanding, 300000)
  const ledger = ledgerView({ contact, note: 'n', entries: [{ date: '2026-10-10', entry_type: 'sale', description: 'Sale', amount: '5000.00', effect: '5000.00', running_balance: '5000.00', status: null, transaction_id: 't1', payment_id: null }, { date: '2026-10-11', entry_type: 'payment', description: 'Paid', amount: '2000.00', effect: '-2000.00', running_balance: '3000.00', status: 'completed', transaction_id: 't1', payment_id: 'p1' }] })
  assert.deepEqual(ledger.entries.map((entry) => [entry.effect, entry.runningBalance]), [[500000, 500000], [-200000, 300000]])
})

test('payment methods map between labels and backend values', () => {
  assert.equal(methodToApi('Cash'), 'cash')
  assert.equal(methodToApi('Bank transfer'), 'bank')
  assert.equal(methodToApi('JazzCash'), 'mobile_wallet')
  assert.throws(() => methodToApi('Bitcoin'))
  assert.equal(methodLabel('mobile_wallet'), 'Mobile wallet (Easypaisa / JazzCash)')
  assert.equal(categoryLabel('groceries'), 'Groceries')
  assert.equal(categoryLabel(''), 'Uncategorised')
})

test('create bodies use decimal strings and only send a method when money changed hands', () => {
  const form = { type: 'sale', amount: '1250.25', paid: '250.25', method: 'cash', reference: '', description: ' Flour ', category: 'Groceries', notes: '', date: '2026-10-10', dueDate: '2026-10-20', party: ' Ali ', source: 'AI text' }
  assert.deepEqual(transactionCreateBody(form), { type: 'sale', amount: '1250.25', amount_paid: '250.25', payment_method: 'cash', payment_reference: null, description: 'Flour', category: 'Groceries', notes: null, transaction_date: '2026-10-10', due_date: '2026-10-20', source: 'ai', contact_name: 'Ali' })
  const unpaid = transactionCreateBody({ ...form, paid: '0', party: '', contactId: 'c1' })
  assert.equal(unpaid.payment_method, null)
  assert.equal(unpaid.contact_id, 'c1')
  assert.equal(unpaid.contact_name, undefined)
  const paidInFull = transactionCreateBody({ ...form, paid: '1250.25' })
  assert.equal(paidInFull.due_date, null)
  assert.throws(() => transactionCreateBody({ ...form, amount: 'abc' }))
})

test('update bodies contain only changed fields', () => {
  const original = transactionView(apiTransaction)
  const form = transactionFormValues(original)
  assert.deepEqual(transactionUpdateBody(original, form), {})
  assert.deepEqual(transactionUpdateBody(original, { ...form, amount: '5500', description: 'Grocery khata' }), { amount: '5500.00', description: 'Grocery khata' })
  assert.deepEqual(transactionUpdateBody(original, { ...form, dueDate: '' }), { due_date: null })
})

test('AI and receipt drafts become editable form values without inventing payment', () => {
  const draft = transactionFormValues({ type: 'expense', amount: '1200.50', amount_paid: null, description: 'Receipt', contact_name: 'Bilal Store', transaction_date: '2026-10-09', payment_method: null, source: 'receipt' })
  assert.equal(draft.amount, '1200.50')
  assert.equal(draft.paid, '')
  assert.equal(draft.party, 'Bilal Store')
  assert.equal(draft.method, 'cash')
})

test('insights and bank records convert money and keep missing baselines as null', () => {
  const view = insightsView({ period: { name: 'this_month', label: 'This month', date_from: '2026-10-01', date_to: '2026-10-10' }, previous_period: { name: 'custom', label: 'Previous', date_from: '2026-09-21', date_to: '2026-09-30' }, total_current: '4200.00', total_previous: '0.00', change: '4200.00', change_percent: null, top_category: 'utilities', categories: [{ category: 'utilities', current: '4200.00', previous: '0.00', change: '4200.00', change_percent: null }], increases: [], decreases: [], unusual_expenses: [], data_notes: ['No earlier records.'], summary: 's', suggestions: [], ai_generated: false, grounding_check: 'not_applicable', rules: {} })
  assert.equal(view.totalCurrent, 420000)
  assert.equal(view.changePercent, null)
  assert.equal(view.categories[0].percent, null)
  const bank = bankTransactionView({ id: 'b1', account_id: 'a', reference: 'DDB-1', direction: 'in', amount: '1000.00', currency: 'PKR', counterparty_name: 'Ali', counterparty_account_masked: '****1234', description: null, status: 'pending', occurred_at: '2026-10-10T09:00:00Z', is_synthetic: true, imported: false, import_id: null, disclaimer: 'DEMO' })
  assert.equal(bank.amount, 100000)
  assert.equal(bank.status, 'pending')
})
