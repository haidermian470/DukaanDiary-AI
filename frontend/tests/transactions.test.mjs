import test from 'node:test'
import assert from 'node:assert/strict'
import { toMinor, validateTransaction, periodRange, paymentStatus } from '../src/features/transactions/model.js'
import { demoSummary, makeDemoRecords, withDemoPayments, createDemoSettlement, demoBankRecords, createDemoBankImport } from '../src/services/demo.js'

test('money input preserves minor units and rejects invalid precision', () => {
  assert.equal(toMinor('0.29'), 29)
  assert.equal(toMinor('2500.1'), 250010)
  for (const input of ['-1', '1.234', 'NaN', '1e5', '', '1000000000']) assert.equal(toMinor(input), null)
})
test('partial payment requires a party and never exceeds total', () => {
  const row = { type: 'sale', description: 'Flour', amount: '100', paid: '50', date: '2026-10-10', category: 'Groceries', party: '' }
  assert.ok(validateTransaction(row).party)
  assert.deepEqual(validateTransaction({ ...row, party: 'Sample customer' }), {})
  assert.ok(validateTransaction({ ...row, paid: '101' }).paid)
  assert.ok(validateTransaction({ ...row, date: '2026-02-30' }).date)
})
test('sample repayments affect cash and receivables without extra sales', () => {
  const rows = makeDemoRecords()
  const before = demoSummary(rows.filter((row) => row.type !== 'payment_received'), {})
  const after = demoSummary(rows, {})
  assert.equal(after.sales, before.sales)
  assert.equal(after.received - before.received, 200000)
  assert.equal(before.receivables - after.receivables, 200000)
  assert.equal(paymentStatus(withDemoPayments(rows).find((row) => row.id === 'sample-2')), 'Partially paid')
})
test('purchase settlements do not duplicate purchases or operating expenses', () => {
  const rows = makeDemoRecords()
  const before = demoSummary(rows, {})
  const after = demoSummary([...rows, { id: 'payment', type: 'payment_made', obligationId: 'sample-6', amount: 10000, paid: 10000, date: rows[0].date }], {})
  assert.equal(after.purchases, before.purchases)
  assert.equal(after.expenses, before.expenses)
  assert.equal(after.paid - before.paid, 10000)
  assert.equal(before.payables - after.payables, 10000)
})
test('week ranges begin Monday and month ranges respect year boundaries', () => {
  assert.deepEqual(periodRange('week', {}, '2026-01-01'), { start: '2025-12-29', end: '2026-01-01' })
  assert.deepEqual(periodRange('month', {}, '2026-10-10'), { start: '2026-10-01', end: '2026-10-10' })
})
test('empty periods do not report current cash as historical cash', () => {
  const result = demoSummary(makeDemoRecords(), { start: '2000-01-01', end: '2000-01-02' })
  for (const field of ['sales', 'expenses', 'purchases', 'received', 'paid', 'receivables', 'payables']) assert.equal(result[field], 0)
})

test('settlements are linked and reject overpayment, invalid dates, and missing obligations', () => {
  const rows = makeDemoRecords()
  const input = { obligationId: 'sample-2', amount: 100000, date: rows[0].date, method: 'Cash' }
  const payment = createDemoSettlement(rows, input)
  assert.equal(payment.type, 'payment_received')
  assert.equal(payment.obligationId, 'sample-2')
  assert.throws(() => createDemoSettlement(rows, { ...input, amount: 300001 }), /remaining balance/)
  assert.throws(() => createDemoSettlement(rows, { ...input, date: '2026-02-30' }), /valid/)
  assert.throws(() => createDemoSettlement(rows, { ...input, obligationId: 'missing' }), /existing/)
})

test('demo import is duplicate-safe and refuses pending records or the wrong party', () => {
  const rows = makeDemoRecords()
  const bank = demoBankRecords()
  const payment = createDemoBankImport(rows, bank[0], 'sample-2')
  assert.equal(payment.source, 'bank import')
  assert.equal(payment.bankId, bank[0].id)
  assert.throws(() => createDemoBankImport([payment, ...rows], bank[0], 'sample-2'), /already been imported/)
  assert.throws(() => createDemoBankImport(rows, bank[2], 'sample-5'), /completed/)
  assert.throws(() => createDemoBankImport(rows, bank[0], 'sample-6'), /same party/)
  const summary = demoSummary([payment, ...rows], {})
  assert.equal(summary.sales, demoSummary(rows, {}).sales)
})
