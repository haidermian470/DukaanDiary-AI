import { inRange, today } from '../features/transactions/model.js'

export function createDemoSettlement(records, { obligationId, amount, date, method, bankId }) {
  const obligation = withDemoPayments(records).find((row) => row.id === obligationId)
  if (!obligation || !['sale', 'purchase', 'expense'].includes(obligation.type)) throw new Error('Select an existing sale, purchase, or expense.')
  if (bankId && records.some((row) => row.bankId === bankId)) throw new Error('This demo bank transaction has already been imported.')
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > obligation.amount - obligation.settledPaid) throw new Error('Payment must be positive and cannot exceed the remaining balance.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < obligation.date || date > today()) throw new Error('Payment date must be valid and between the obligation date and today.')
  return { id: crypto.randomUUID(), type: obligation.type === 'sale' ? 'payment_received' : 'payment_made', description: `Payment for ${obligation.description}`, party: obligation.party, amount, paid: amount, obligationId, category: 'Settlement', date, method, source: bankId ? 'bank import' : 'manual', ...(bankId ? { bankId } : {}) }
}

export const demoBankRecords = () => [
  { id: 'DEMO-1001', reference: 'SYN-ALI-01', party: 'Ali Raza', direction: 'incoming', amount: 100000, date: today(), status: 'completed' },
  { id: 'DEMO-1002', reference: 'SYN-RASHID-02', party: 'Rashid Wholesale', direction: 'outgoing', amount: 300000, date: today(), status: 'completed' },
  { id: 'DEMO-1003', reference: 'SYN-BASHIR-03', party: 'Bashir Ahmed', direction: 'incoming', amount: 145000, date: today(), status: 'pending' },
  { id: 'DEMO-1004', reference: 'SYN-FAIL-04', party: 'Demo customer', direction: 'incoming', amount: 50000, date: today(), status: 'failed' },
]

export function createDemoBankImport(records, bank, obligationId) {
  if (bank.status !== 'completed') throw new Error('Only completed demo transactions can be imported.')
  const obligation = records.find((row) => row.id === obligationId)
  if (!obligation || obligation.party !== bank.party || (bank.direction === 'incoming' ? obligation.type !== 'sale' : !['purchase', 'expense'].includes(obligation.type))) throw new Error('Choose an obligation for the same party and payment direction.')
  return createDemoSettlement(records, { obligationId, amount: bank.amount, date: bank.date, method: 'Dummy Bank', bankId: bank.id })
}

export function withDemoPayments(records) {
  return records.map((row) => ({ ...row, settledPaid: row.paid + records.filter((payment) => payment.obligationId === row.id).reduce((sum, payment) => sum + payment.amount, 0) }))
}

// Synthetic, browser-only fixture adapter. Never use these calculations for live records.
export function makeDemoRecords() {
  const day = today()
  return [
    { id: 'sample-1', type: 'sale', description: '10kg Atta & Cooking Oil', party: 'Counter customer', amount: 385000, paid: 385000, category: 'Groceries', date: day, method: 'Cash', source: 'manual' },
    { id: 'sample-2', type: 'sale', description: 'Monthly grocery khata', party: 'Ali Raza', amount: 500000, paid: 0, category: 'Groceries', date: day, method: 'Cash', source: 'manual' },
    { id: 'sample-3', type: 'payment_received', description: 'Khata repayment', party: 'Ali Raza', amount: 200000, paid: 200000, obligationId: 'sample-2', category: 'Settlement', date: day, method: 'Bank transfer', source: 'manual' },
    { id: 'sample-4', type: 'expense', description: 'Dukan Bijli Bill', party: 'Electricity provider', amount: 420000, paid: 420000, category: 'Utilities', date: day, method: 'Cash', source: 'manual' },
    { id: 'sample-5', type: 'sale', description: '2x Ghee Pouches', party: 'Bashir Ahmed', amount: 145000, paid: 0, category: 'Groceries', date: day, method: 'Cash', source: 'manual' },
    { id: 'sample-6', type: 'purchase', description: 'Weekly stock delivery', party: 'Rashid Wholesale', amount: 1950000, paid: 750000, category: 'Inventory', date: day, method: 'Cash', source: 'manual' },
  ]
}

export function demoSummary(records, range) {
  const selected = records.filter((row) => inRange(row, range))
  const sum = (rows, field = 'amount') => rows.reduce((total, row) => total + row[field], 0)
  const type = (name) => selected.filter((row) => row.type === name)
  const balances = records.filter((row) => !range.end || row.date <= range.end)
  const remaining = (kind, payment) => sum(balances.filter((row) => row.type === kind)) - sum(balances.filter((row) => row.type === kind), 'paid') - sum(balances.filter((row) => row.type === payment && balances.some((obligation) => obligation.id === row.obligationId && obligation.type === kind)))
  const expenses = type('expense')
  const categories = [...new Set(expenses.map((row) => row.category))].map((name) => ({ name, value: sum(expenses.filter((row) => row.category === name)) / 100 }))
  const series = [...new Set(selected.map((row) => row.date))].sort().map((date) => {
    const rows = selected.filter((row) => row.date === date)
    return { date: date.slice(5), sales: sum(rows.filter((row) => row.type === 'sale')) / 100, expenses: sum(rows.filter((row) => row.type === 'expense')) / 100 }
  })
  return {
    sales: sum(type('sale')), purchases: sum(type('purchase')), expenses: sum(expenses),
    received: sum(type('sale'), 'paid') + sum(type('payment_received')),
    paid: sum(type('purchase'), 'paid') + sum(expenses, 'paid') + sum(type('payment_made')),
    receivables: remaining('sale', 'payment_received'), payables: remaining('purchase', 'payment_made'), categories, series,
  }
}
