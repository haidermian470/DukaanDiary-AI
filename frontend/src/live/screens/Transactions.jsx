import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import DateFilter from '../../components/ui/DateFilter'
import Modal from '../../components/ui/Modal'
import Feedback from '../../components/ui/Feedback'
import PageHeader from '../../components/ui/PageHeader'
import { today, money } from '../../features/transactions/model'
import { TRANSACTION_TYPES, SETTLEMENT_LABELS, dateRangeQuery, pageView, transactionView } from '../../services/adapters'
import { useLive, useResource } from '../context.js'
import { ErrorNotice, Loading } from '../ui'
import TransactionRows from '../components/TransactionRows'

const PAGE_SIZE = 20

function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer) }, [value, delay])
  return debounced
}

export default function Transactions() {
  const { api } = useLive()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [overdue, setOverdue] = useState(false)
  const [period, setPeriod] = useState('all')
  const [custom, setCustom] = useState({ start: today(), end: today() })
  const [voiding, setVoiding] = useState(null)
  const [voidError, setVoidError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(location.state?.notice ?? '')
  const [more, setMore] = useState({ key: null, items: [], page: 1, hasMore: false, loading: false, error: null })
  const search = useDebounced(query.trim())
  const dates = dateRangeQuery(period, custom, today())
  const filters = { ...dates, search, type, settlement_status: status, overdue_only: overdue || undefined }
  const filterKey = JSON.stringify(filters)

  const fetchPage = async (page, signal) => pageView(await api.listTransactions({ ...filters, page, page_size: PAGE_SIZE }, { signal }), transactionView)
  const first = useResource(dates && ((signal) => fetchPage(1, signal)), [filterKey])
  const extra = more.key === filterKey && first.data && !first.loading ? more : { items: [], page: 1, hasMore: first.data?.hasMore ?? false, loading: false, error: null }
  const items = first.data ? [...first.data.items, ...extra.items.filter((row) => !first.data.items.some((item) => item.id === row.id))] : []
  const total = first.data?.total ?? 0
  const loading = first.loading
  const error = first.error ?? extra.error

  async function loadMore() {
    const page = extra.page + 1
    setMore({ ...extra, key: filterKey, loading: true, error: null })
    try {
      const result = await fetchPage(page)
      setMore({ key: filterKey, items: [...extra.items, ...result.items], page, hasMore: result.hasMore, loading: false, error: null })
    } catch (err) { setMore({ ...extra, key: filterKey, loading: false, error: err }) }
  }
  const reload = () => { setMore({ key: null, items: [], page: 1, hasMore: false, loading: false, error: null }); first.reload() }

  async function confirmVoid() {
    setBusy(true); setVoidError(null)
    try {
      await api.voidTransaction(voiding.id)
      setNotice(`"${voiding.description}" was voided. It and its payments no longer count in any total.`)
      setVoiding(null)
      reload()
    } catch (err) { setVoidError(err) } finally { setBusy(false) }
  }

  const clear = () => { setQuery(''); setType(''); setStatus(''); setOverdue(false); setPeriod('all') }
  return <>
    <PageHeader title="Transactions" actions={<Link className="button primary" to="/transactions/new"><Plus size={18} />Add transaction</Link>} />
    <p className="subtitle">Sales, purchases and expenses. Payments are recorded against each record or in Khata.</p>
    {notice && <p role="status" className="success-message">{notice}</p>}
    <DateFilter period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} allowAll />
    <div className="list-toolbar">
      <label className="search"><Search size={18} /><input aria-label="Search transactions" placeholder="Search description or category" value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} /></label>
      <label>Type<select value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{TRANSACTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Payment<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{Object.entries(SETTLEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="check-field"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />Overdue only</label>
    </div>
    <div className="section-heading"><h2>Transaction history</h2><span>{loading && !first.data ? 'Loading...' : `${total} records`}</span></div>
    <ErrorNotice error={error} onRetry={reload} title="Transactions could not be loaded." />
    {loading && first.data && <Loading>Updating...</Loading>}
    {!dates ? <p role="alert" className="error-message">Choose a valid date range.</p>
      : loading && !first.data ? <Loading>Loading transactions...</Loading>
        : items.length ? <>
          <TransactionRows rows={items} onVoid={(row) => { setVoiding(row); setVoidError(null) }} />
          {extra.hasMore && <button type="button" className="button view-all-button" disabled={extra.loading} onClick={loadMore}>{extra.loading ? 'Loading...' : `Load more (${items.length} of ${total})`}</button>}
        </>
          : !error && <Feedback title="No matching transactions"><p>Try another search or date range, or add a new record.</p><button type="button" className="button" onClick={clear}>Clear filters</button></Feedback>}
    {voiding && <Modal title="Void this transaction?" onClose={() => !busy && setVoiding(null)}>
      <p><strong>{voiding.description}</strong> · {money(voiding.amount)}</p>
      <p>Voiding removes this record and its payments from every total. It stays in the audit history and cannot be undone here.</p>
      {voiding.paid > 0 && <p className="warning-message">{money(voiding.paid)} in payments is linked to this record and will also stop counting.</p>}
      <ErrorNotice error={voidError} />
      <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={() => setVoiding(null)}>Cancel</button><button type="button" className="button destructive" disabled={busy} onClick={confirmVoid}>{busy ? 'Voiding...' : 'Void transaction'}</button></div>
    </Modal>}
  </>
}
