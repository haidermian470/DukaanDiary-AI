import { useState } from 'react'
import { Download, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import DateFilter from '../../components/ui/DateFilter'
import SalesExpenseChart from '../../features/dashboard/SalesExpenseChart'
import { today, money } from '../../features/transactions/model'
import { SETTLEMENT_LABELS, TRANSACTION_TYPES, categoryLabel, pageView, periodQuery, reportView, transactionView } from '../../services/adapters'
import { parseOptionalMoney } from '../../services/money'
import { useLive, useResource } from '../context.js'
import { ErrorNotice, Loading } from '../ui'
import TransactionRows from '../components/TransactionRows'

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function DuesList({ title, rows }) {
  return <section className="space-top"><h2>{title}</h2>{rows.length ? rows.map((row) => <div className="category-row" key={row.id}><span>{row.name}{row.earliest_due_date ? <small className="text-muted"> · due from {row.earliest_due_date}</small> : null}</span><strong>{money(parseOptionalMoney(row.outstanding) ?? 0)}</strong></div>) : <p className="empty-inline">None.</p>}</section>
}

export default function Reports() {
  const { api } = useLive()
  const [period, setPeriod] = useState('month')
  const [custom, setCustom] = useState({ start: today(), end: today() })
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [download, setDownload] = useState({ busy: false, error: null, notice: '' })
  const query = periodQuery(period, custom)
  const filters = { type, settlement_status: status }
  const key = JSON.stringify([query, filters])
  const report = useResource(query && (async (signal) => reportView(await api.reportSummary(query, { signal }))), [JSON.stringify(query)])
  const rows = useResource(query && (async (signal) => pageView(await api.reportTransactions(query, { ...filters, page_size: 100 }, { signal }), transactionView)), [key])

  async function exportCsv() {
    setDownload({ busy: true, error: null, notice: '' })
    try {
      const { blob, filename } = await api.reportCsv(query, filters)
      saveBlob(blob, filename ?? `dukaandiary_${report.data?.period.start ?? 'report'}.csv`)
      setDownload({ busy: false, error: null, notice: 'CSV download started.' })
    } catch (error) { setDownload({ busy: false, error, notice: '' }) }
  }

  const r = report.data
  return <>
    <PageHeader title="Reports" actions={<button type="button" className="button" onClick={exportCsv} disabled={!query || download.busy || rows.data?.total === 0}><Download size={17} />{download.busy ? 'Preparing...' : 'Export CSV'}</button>} />
    <p className="subtitle">Sales, purchases, expenses and cash movement, shown separately.</p>
    <DateFilter period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} allowAll />
    {download.notice && <p role="status" className="success-message">{download.notice}</p>}
    <ErrorNotice error={download.error} title="The CSV could not be downloaded." />
    {!query ? <p role="alert" className="error-message">Choose a valid date range.</p> : <>
      <ErrorNotice error={report.error} onRetry={report.reload} title="The report could not be loaded." />
      {!r && report.loading && <Loading>Loading report...</Loading>}
      {r && <>
        <p className="section-note">{r.period.label}: {r.period.start} to {r.period.end}. Balances are as of {r.balances.asOf}.</p>
        <div className="analytics-totals">{[
          ['Sales', r.sales], ['Stock purchases', r.purchases], ['Operating expenses', r.expenses], ['Money received', r.received], ['Money paid', r.paid], ['Net cash flow', r.netCashFlow], ['Customers owe you', r.balances.receivables], ['You owe suppliers', r.balances.payables],
        ].map(([label, amount]) => <div key={label}><span>{label}</span><strong className={amount < 0 ? 'text-red' : ''}>{money(amount)}</strong></div>)}</div>
        <div className="workflow-columns">
          <section>
            <SalesExpenseChart sales={r.sales} expenses={r.expenses} range={r.period} />
            <div className="section-heading space-top"><h2>Expense categories</h2><Link to="/insights">Insights <ArrowRight size={15} /></Link></div>
            {r.categories.length ? r.categories.map((c) => <div className="category-row" key={c.name}><span>{categoryLabel(c.name)} <small className="text-muted">{c.count} · {c.share}%</small></span><strong>{money(c.total)}</strong></div>) : <p className="empty-inline">No operating expenses in this period.</p>}
          </section>
          <section className="workflow-aside">
            <DuesList title="Customers who owe the most" rows={r.topCustomers} />
            <DuesList title="Suppliers you owe the most" rows={r.topSuppliers} />
            <h2>Notes</h2>{r.limitations.map((text) => <p key={text}>{text}</p>)}
          </section>
        </div>
      </>}
      <div className="section-heading space-top"><h2>Records in this report</h2><span>{rows.data ? `${rows.data.total} records${rows.data.hasMore ? ' (first 100 shown; CSV has all)' : ''}` : ''}</span></div>
      <div className="list-toolbar">
        <label>Type<select value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{TRANSACTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Payment<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{Object.entries(SETTLEMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <ErrorNotice error={rows.error} onRetry={rows.reload} title="Records could not be loaded." />
      {rows.data ? rows.data.items.length ? <TransactionRows rows={rows.data.items} compact /> : <p className="empty-inline">No records match this report.</p> : rows.loading && <Loading>Loading records...</Loading>}
    </>}
  </>
}
