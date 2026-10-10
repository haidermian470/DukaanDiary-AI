// Converters between backend response/request shapes and the frontend's view shapes.
// Kept separate from React components so they can be tested on their own.
//
// Money in view objects is always integer paisa (see money.js). Request bodies use the
// backend's decimal strings. Nothing here calculates authoritative totals: values come
// from the backend and are only converted for display.
import { parseMoney, parseOptionalMoney, toDecimalString } from './money.js'
import { toMinor } from '../features/transactions/model.js'

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------
export const PAYMENT_METHODS = [
  ['cash', 'Cash'],
  ['bank', 'Bank transfer'],
  ['mobile_wallet', 'Mobile wallet (Easypaisa / JazzCash)'],
  ['cheque', 'Cheque'],
  ['other', 'Other'],
]
const METHOD_LABELS = Object.fromEntries(PAYMENT_METHODS)
export const methodLabel = (value) => METHOD_LABELS[value] ?? (value ? String(value) : 'Not recorded')

// Labels used by the older sample workspace, mapped to backend values.
const LEGACY_METHODS = { cash: 'cash', 'bank transfer': 'bank', bank: 'bank', 'dummy bank': 'bank', easypaisa: 'mobile_wallet', jazzcash: 'mobile_wallet', 'mobile wallet': 'mobile_wallet', mobile_wallet: 'mobile_wallet', cheque: 'cheque', other: 'other' }
export function methodToApi(label) {
  const value = LEGACY_METHODS[String(label ?? '').trim().toLowerCase()]
  if (!value) throw new Error(`Unknown payment method: ${label}`)
  return value
}

export const TRANSACTION_TYPES = [['sale', 'Sale'], ['purchase', 'Purchase'], ['expense', 'Expense']]
export const typeLabel = (type) => Object.fromEntries(TRANSACTION_TYPES)[type] ?? type

export const SETTLEMENT_LABELS = { paid: 'Paid', partially_paid: 'Partially paid', unpaid: 'Unpaid' }
export const PAYMENT_STATUS_LABELS = { completed: 'Completed', pending: 'Pending', failed: 'Failed', cancelled: 'Cancelled' }
export const statusTone = (status) => ({ paid: 'green', completed: 'green', partially_paid: 'amber', pending: 'amber', unpaid: 'amber', failed: 'red', cancelled: 'neutral' })[status] ?? 'neutral'

// Frontend source names -> backend `source` values.
const SOURCES = { manual: 'manual', ai: 'ai', 'ai text': 'ai', voice: 'voice', receipt: 'receipt' }
export const sourceToApi = (source) => SOURCES[String(source ?? 'manual').toLowerCase()] ?? 'manual'

/** Backend categories are stored lower-case ("groceries"); show them in sentence case. */
export function categoryLabel(category) {
  const text = String(category ?? '').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : 'Uncategorised'
}

// ---------------------------------------------------------------------------
// Periods: frontend date filter -> backend query parameters
// ---------------------------------------------------------------------------
const PERIODS = { today: 'today', week: 'this_week', month: 'this_month', all: 'all_time' }

/** Returns query parameters for the backend, or null when a custom range is incomplete/invalid. */
export function periodQuery(period, custom = {}) {
  if (period === 'custom') {
    const { start, end } = custom
    const valid = /^\d{4}-\d{2}-\d{2}$/
    if (!valid.test(start ?? '') || !valid.test(end ?? '') || start > end) return null
    return { period: 'custom', date_from: start, date_to: end }
  }
  const name = PERIODS[period]
  if (!name) throw new Error(`Unknown period: ${period}`)
  return { period: name }
}

/** Date filters for list endpoints that take date_from/date_to only (no named periods). */
export function dateRangeQuery(period, custom, todayValue) {
  if (period === 'all') return {}
  if (period === 'custom') {
    const query = periodQuery('custom', custom)
    return query ? { date_from: query.date_from, date_to: query.date_to } : null
  }
  const end = todayValue
  const date = new Date(`${end}T00:00:00Z`)
  if (period === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  if (period === 'month') date.setUTCDate(1)
  return { date_from: date.toISOString().slice(0, 10), date_to: end }
}

export function periodView(period) {
  if (!period) return null
  return { name: period.name, label: period.label, start: period.date_from, end: period.date_to }
}

// ---------------------------------------------------------------------------
// Response -> view
// ---------------------------------------------------------------------------
export function contactRefView(contact) {
  return contact ? { id: contact.id, name: contact.name, kind: contact.kind } : null
}

export function transactionView(row) {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    category: row.category,
    notes: row.notes ?? '',
    date: row.transaction_date,
    dueDate: row.due_date ?? '',
    contact: contactRefView(row.contact),
    party: row.contact?.name ?? '',
    source: row.source,
    isDemo: Boolean(row.is_demo),
    amount: parseMoney(row.amount),
    paid: parseMoney(row.amount_paid),
    pending: parseMoney(row.amount_pending ?? '0'),
    outstanding: parseMoney(row.outstanding),
    status: row.settlement_status,
    isOverdue: Boolean(row.is_overdue),
    payments: Array.isArray(row.payments) ? row.payments.map(paymentView) : undefined,
  }
}

export function paymentView(row) {
  return {
    id: row.id,
    transactionId: row.transaction_id ?? null,
    contact: contactRefView(row.contact),
    direction: row.direction,
    amount: parseMoney(row.amount),
    date: row.payment_date,
    method: row.method,
    status: row.status,
    reference: row.reference ?? '',
    notes: row.notes ?? '',
    isAdvance: Boolean(row.is_advance),
    fromDummyBank: Boolean(row.from_dummy_bank),
    isDemo: Boolean(row.is_demo),
  }
}

export function pageView(page, mapItem) {
  return { items: page.items.map(mapItem), total: page.total, page: page.page, pageSize: page.page_size, hasMore: Boolean(page.has_more) }
}

export function contactView(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    phone: row.phone ?? '',
    notes: row.notes ?? '',
    isDemo: Boolean(row.is_demo),
    totalBilled: parseOptionalMoney(row.total_billed) ?? 0,
    totalSettled: parseOptionalMoney(row.total_settled) ?? 0,
    outstanding: parseOptionalMoney(row.outstanding) ?? 0,
    overdue: parseOptionalMoney(row.overdue_amount) ?? 0,
    isOverdue: Boolean(row.is_overdue),
    earliestDueDate: row.earliest_due_date ?? null,
    openItems: row.open_items ?? 0,
    advance: parseOptionalMoney(row.advance_balance) ?? 0,
  }
}

export function ledgerView(ledger) {
  return {
    contact: contactView(ledger.contact),
    note: ledger.note,
    entries: ledger.entries.map((entry) => ({
      date: entry.date,
      type: entry.entry_type,
      description: entry.description,
      amount: parseMoney(entry.amount),
      effect: parseMoney(entry.effect),
      runningBalance: parseMoney(entry.running_balance),
      status: entry.status ?? null,
      transactionId: entry.transaction_id ?? null,
      paymentId: entry.payment_id ?? null,
    })),
  }
}

export function summaryView(summary) {
  const f = summary.figures
  const b = summary.balances
  return {
    period: periodView(summary.period),
    sales: parseMoney(f.total_sales),
    purchases: parseMoney(f.total_purchases),
    expenses: parseMoney(f.total_expenses),
    received: parseMoney(f.money_received),
    paid: parseMoney(f.money_paid),
    netCashFlow: parseMoney(f.net_cash_flow),
    counts: { sales: f.sales_count, purchases: f.purchases_count, expenses: f.expenses_count },
    balances: {
      asOf: b.as_of,
      receivables: parseMoney(b.receivables),
      payables: parseMoney(b.payables),
      overdueReceivables: parseMoney(b.overdue_receivables),
      overduePayables: parseMoney(b.overdue_payables),
      openReceivableItems: b.open_receivable_items,
      openPayableItems: b.open_payable_items,
    },
    receivedBreakdown: Object.entries(summary.received_breakdown ?? {}).map(([key, value]) => ({ key, amount: parseMoney(value) })),
    recent: (summary.recent_transactions ?? []).map(transactionView),
    hasDemoData: Boolean(summary.has_demo_data),
    definitions: summary.definitions ?? {},
  }
}

export function trendsView(trends) {
  return {
    period: periodView(trends.period),
    granularity: trends.granularity,
    points: trends.points.map((point) => ({
      start: point.bucket_start,
      end: point.bucket_end,
      sales: parseMoney(point.sales),
      purchases: parseMoney(point.purchases),
      expenses: parseMoney(point.expenses),
      received: parseMoney(point.money_received),
      paid: parseMoney(point.money_paid),
    })),
  }
}

export function categoryTotalsView(categories) {
  return categories.map((item) => ({ name: item.category, total: parseMoney(item.total), count: item.count, share: item.share_percent }))
}

export function breakdownView(breakdown) {
  return { period: periodView(breakdown.period), total: parseMoney(breakdown.total), categories: categoryTotalsView(breakdown.categories) }
}

export function reportView(report) {
  const summary = summaryView({ ...report, recent_transactions: [], received_breakdown: {} })
  return {
    ...summary,
    categories: categoryTotalsView(report.expense_categories ?? []),
    topCustomers: report.top_customers_owing ?? [],
    topSuppliers: report.top_suppliers_owed ?? [],
    limitations: report.limitations ?? [],
  }
}

export function bankTransactionView(row) {
  return {
    id: row.id,
    reference: row.reference,
    direction: row.direction,
    amount: parseMoney(row.amount),
    currency: row.currency,
    party: row.counterparty_name,
    partyAccount: row.counterparty_account_masked ?? '',
    description: row.description ?? '',
    status: row.status,
    occurredAt: row.occurred_at,
    imported: Boolean(row.imported),
    disclaimer: row.disclaimer,
  }
}

export function insightsView(data) {
  const change = (item) => ({ category: item.category, current: parseMoney(item.current), previous: parseMoney(item.previous), change: parseMoney(item.change), percent: item.change_percent ?? null })
  return {
    period: periodView(data.period),
    previousPeriod: periodView(data.previous_period),
    totalCurrent: parseMoney(data.total_current),
    totalPrevious: parseMoney(data.total_previous),
    change: parseMoney(data.change),
    changePercent: data.change_percent ?? null,
    topCategory: data.top_category ?? null,
    categories: data.categories.map(change),
    increases: data.increases.map(change),
    decreases: data.decreases.map(change),
    unusual: data.unusual_expenses.map((item) => ({ id: item.transaction_id, date: item.date, description: item.description, category: item.category, amount: parseMoney(item.amount), typical: parseMoney(item.typical_amount), times: item.times_typical })),
    notes: data.data_notes ?? [],
    summary: data.summary,
    suggestions: data.suggestions ?? [],
    aiGenerated: Boolean(data.ai_generated),
    grounding: data.grounding_check,
    rules: data.rules ?? {},
  }
}

// ---------------------------------------------------------------------------
// Form values -> request bodies
// ---------------------------------------------------------------------------
const nullable = (value) => {
  const text = String(value ?? '').trim()
  return text ? text : null
}

/** Build a TransactionCreate body from validated form values (amounts typed in rupees). */
export function transactionCreateBody(form) {
  const amount = toMinor(form.amount)
  const paid = toMinor(form.paid)
  if (amount === null || paid === null) throw new Error('Amounts must be validated before saving.')
  const body = {
    type: form.type,
    amount: toDecimalString(amount),
    amount_paid: toDecimalString(paid),
    payment_method: paid > 0 ? form.method : null,
    payment_reference: paid > 0 ? nullable(form.reference) : null,
    description: form.description.trim(),
    category: nullable(form.category),
    notes: nullable(form.notes),
    transaction_date: form.date,
    due_date: paid < amount ? nullable(form.dueDate) : null,
    source: sourceToApi(form.source),
  }
  if (form.contactId) body.contact_id = form.contactId
  else if (nullable(form.party)) body.contact_name = form.party.trim()
  return body
}

/** Build a TransactionUpdate body containing only the fields the user changed. */
export function transactionUpdateBody(original, form) {
  const body = {}
  const amount = toMinor(form.amount)
  if (amount === null) throw new Error('Amounts must be validated before saving.')
  if (form.description.trim() !== original.description) body.description = form.description.trim()
  if ((nullable(form.category) ?? '').toLowerCase() !== (original.category ?? '').toLowerCase()) body.category = nullable(form.category)
  if ((nullable(form.notes) ?? '') !== (original.notes ?? '')) body.notes = nullable(form.notes)
  if (amount !== original.amount) body.amount = toDecimalString(amount)
  if (form.date !== original.date) body.transaction_date = form.date
  if ((nullable(form.dueDate) ?? '') !== (original.dueDate ?? '')) body.due_date = nullable(form.dueDate)
  if ((nullable(form.party) ?? '') !== (original.party ?? '')) {
    if (form.contactId && form.contactId !== original.contact?.id) body.contact_id = form.contactId
    else body.contact_name = nullable(form.party)
  }
  return body
}

/** Merge draft values over a blank form. Empty draft fields keep the defaults, except the
 * paid amount: an unknown payment stays empty so the user must enter it. */
export function mergeDraft(blank, draft) {
  const values = transactionFormValues(draft)
  const merged = { ...blank }
  for (const [key, value] of Object.entries(values)) if (value !== '' || key === 'paid') merged[key] = value
  return merged
}

/** Turn an API transaction (or AI/receipt draft) into transaction form values. */
export function transactionFormValues(source) {
  const rupees = (minor) => (minor === null || minor === undefined ? '' : toDecimalString(minor).replace(/\.00$/, ''))
  return {
    type: source.type ?? 'sale',
    description: source.description ?? '',
    party: source.party ?? source.contact_name ?? '',
    contactId: source.contactId ?? source.contact_id ?? '',
    amount: typeof source.amount === 'number' ? rupees(source.amount) : rupees(parseOptionalMoney(source.amount)),
    paid: typeof source.paid === 'number' ? rupees(source.paid) : rupees(parseOptionalMoney(source.amount_paid)),
    date: source.date ?? source.transaction_date ?? '',
    dueDate: source.dueDate ?? source.due_date ?? '',
    category: source.category ?? '',
    method: source.method ?? source.payment_method ?? 'cash',
    reference: source.reference ?? source.payment_reference ?? '',
    notes: source.notes ?? '',
    source: source.source ?? 'manual',
  }
}
