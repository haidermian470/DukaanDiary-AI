// One function per backend route, matching the FastAPI schemas on the backend-dev branch
// (base path /api/v1, already included in VITE_API_BASE_URL). Screens call these
// functions instead of building URLs themselves.
import { ApiError } from './api.js'

const id = (value) => encodeURIComponent(String(value))

// The AI parser returns the exact request to send on confirmation. Only these known
// write routes are accepted, so a malformed response cannot direct a save elsewhere.
const CONFIRM_PATHS = ['/transactions', '/payments', '/payments/settle-contact']
export function confirmPath(confirm) {
  const raw = String(confirm?.path ?? '')
  const path = raw.startsWith('/api/v1/') ? raw.slice('/api/v1'.length) : raw
  if (confirm?.method !== 'POST' || !CONFIRM_PATHS.includes(path)) throw new ApiError('The draft cannot be saved because the server returned an unexpected save action.', { code: 'invalid_response' })
  return path
}

export function createEndpoints(client) {
  const get = (path, query, options) => client.request(path, { query, ...options })
  const post = (path, json, options) => client.request(path, { method: 'POST', json, ...options })
  const patch = (path, json, options) => client.request(path, { method: 'PATCH', json, ...options })
  const upload = (path, file, options = {}) => {
    const formData = new FormData()
    formData.append('file', file)
    return client.upload(path, { formData, ...options })
  }

  return {
    // Health and account
    health: (options) => get('/health', undefined, { auth: false, ...options }),
    ready: (options) => get('/health/ready', undefined, { auth: false, ...options }),
    me: (options) => get('/me', undefined, options),
    renameWorkspace: (name) => patch('/workspaces/current', { name }),

    // Transactions (sales, purchases, expenses)
    listTransactions: (query, options) => get('/transactions', query, options),
    getTransaction: (transactionId, options) => get(`/transactions/${id(transactionId)}`, undefined, options),
    createTransaction: (body, idempotencyKey) => post('/transactions', body, { idempotencyKey }),
    updateTransaction: (transactionId, body) => patch(`/transactions/${id(transactionId)}`, body),
    voidTransaction: (transactionId) => client.request(`/transactions/${id(transactionId)}`, { method: 'DELETE' }),

    // Customers, suppliers and payments
    listContacts: (query, options) => get('/contacts', query, options),
    createContact: (body) => post('/contacts', body),
    getContactLedger: (contactId, options) => get(`/contacts/${id(contactId)}`, undefined, options),
    updateContact: (contactId, body) => patch(`/contacts/${id(contactId)}`, body),
    listPayments: (query, options) => get('/payments', query, options),
    createPayment: (body, idempotencyKey) => post('/payments', body, { idempotencyKey }),
    settleContact: (body, idempotencyKey) => post('/payments/settle-contact', body, { idempotencyKey }),
    updatePayment: (paymentId, body) => patch(`/payments/${id(paymentId)}`, body),

    // Dashboard and reports. `period` is the object from periodQuery().
    dashboardSummary: (period, options) => get('/dashboard/summary', period, options),
    dashboardTrends: (period, granularity = 'day', options) => get('/dashboard/trends', { ...period, granularity }, options),
    expenseBreakdown: (period, options) => get('/dashboard/expense-breakdown', period, options),
    reportSummary: (period, options) => get('/reports/summary', period, options),
    reportTransactions: (period, filters, options) => get('/reports/transactions', { ...period, ...filters }, options),
    reportCsv: (period, filters) => client.request('/reports/transactions', { query: { ...period, ...filters, format: 'csv' }, responseType: 'blob', headers: { Accept: 'text/csv' }, timeoutMs: 60000 }),

    // AI features (drafts and answers only; nothing here saves records)
    parseTransaction: (body, options) => post('/ai/parse-transaction', body, { timeoutMs: 45000, ...options }),
    confirmDraft: (confirm, body, idempotencyKey) => post(confirmPath(confirm), body, { idempotencyKey }),
    askAssistant: (question, options) => post('/ai/assistant', { question }, { timeoutMs: 45000, ...options }),
    expenseInsights: (body, options) => post('/ai/expense-insights', body, { timeoutMs: 45000, ...options }),
    analyzeReceipt: (file, options) => upload('/ai/analyze-receipt', file, options),
    analyzeScreenshot: (file, options) => upload('/ai/analyze-screenshot', file, options),
    screenshotChecks: (limit = 10, options) => get('/ai/screenshot-checks', { limit }, options),

    // Dummy Bank (synthetic demo data only)
    bankAccounts: (options) => get('/dummy-bank/accounts', undefined, options),
    bankTransactions: (query, options) => get('/dummy-bank/transactions', query, options),
    importBankTransaction: (bankId, body) => post(`/dummy-bank/import/${id(bankId)}`, body),
    simulateIncoming: (body) => post('/dummy-bank/simulate/incoming', body),
    simulateStatus: (bankId, status) => post(`/dummy-bank/simulate/transactions/${id(bankId)}/status`, { status }),

    // Fictional demo records (owner only)
    seedDemo: () => post('/demo/seed'),
    resetDemo: () => client.request('/demo/data', { method: 'DELETE', query: { confirm: true } }),
  }
}
