import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PlusCircle, TrendingDown, ShieldCheck, Mic, Store, ShoppingBag, Wallet, ArrowUpRight, Handshake, Truck, Sparkles, ArrowRight, ReceiptText } from 'lucide-react'
import SalesExpenseChart from '../../features/dashboard/SalesExpenseChart'
import DateFilter from '../../components/ui/DateFilter'
import { today, money } from '../../features/transactions/model'
import { periodQuery, summaryView, trendsView, breakdownView, categoryLabel } from '../../services/adapters'
import { useLive, useResource } from '../context.js'
import { ErrorNotice, Loading } from '../ui'
import TransactionRows from '../components/TransactionRows'
import TrendChart from '../components/TrendChart'

function Metric({ label, value, note, icon: Icon, tone = 'green' }) {
  return <article className="metric"><div className="metric-label"><span>{label}</span><span className={`mini-icon ${tone}`}><Icon size={17} /></span></div><strong className={`metric-value text-${tone}`}>{money(value)}</strong><small>{note}</small></article>
}

const GRANULARITY = { today: 'day', week: 'day', month: 'day', all: 'month', custom: 'day' }
const RECEIVED_LABELS = { cash: 'Cash', bank: 'Bank', mobile_wallet: 'Mobile wallet', cheque: 'Cheque', other: 'Other' }

export default function Dashboard() {
  const { api, workspace } = useLive()
  const [period, setPeriod] = useState('today')
  const [custom, setCustom] = useState({ start: today(), end: today() })
  const query = periodQuery(period, custom)
  const key = JSON.stringify(query)
  const { data, error, loading, reload } = useResource(query && (async (signal) => {
    const [summary, trends, breakdown] = await Promise.all([
      api.dashboardSummary(query, { signal }),
      api.dashboardTrends(query, GRANULARITY[period], { signal }),
      api.expenseBreakdown(query, { signal }),
    ])
    return { summary: summaryView(summary), trends: trendsView(trends), breakdown: breakdownView(breakdown) }
  }), [key])

  const s = data?.summary
  const empty = s && !s.sales && !s.purchases && !s.expenses && !s.received && !s.paid && !s.balances.receivables && !s.balances.payables && !s.recent.length
  return <>
    <div className="greeting"><div><h1>Assalam-o-Alaikum!</h1><p><Store size={15} /> {workspace.name} · {workspace.timezone}</p></div><span className="badge green">Live records</span></div>
    <DateFilter period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} allowAll />
    <div className="quick-actions">{[
      ['/transactions/new?type=sale', 'Record sale', 'فروخت اندراج', PlusCircle, 'green'], ['/transactions/new?type=expense', 'Record expense', 'خرچہ اندراج', TrendingDown, 'red'], ['/payment-check', 'AI Tasdeeq', 'ادائیگی کی جانچ', ShieldCheck, 'indigo'], ['/voice', 'Voice Khata', 'آواز سے لکھیں', Mic, 'neutral'],
    ].map(([path, label, urdu, Icon, tone]) => <Link key={path} to={path} className="quick-action"><span className={`record-icon ${tone}`}><Icon size={23} /></span><span><strong>{label}</strong><small lang="ur" dir="rtl">{urdu}</small></span></Link>)}</div>
    {!query ? <p role="alert" className="error-message">Select a valid date range to view the summary.</p>
      : error ? <ErrorNotice title="The summary could not be loaded." error={error} onRetry={reload} />
        : !s ? <Loading>Loading your summary...</Loading>
          : <>
            {loading && <Loading>Updating...</Loading>}
            {s.hasDemoData && <p className="info-message">This shop includes fictional demo records. They are marked "Demo record" and can be removed in Settings.</p>}
            {empty && <section className="feedback"><h2>No records yet</h2><p>Record your first sale or expense to see your hisab-kitab here.</p><Link className="button primary" to="/transactions/new"><PlusCircle size={18} />Add transaction</Link></section>}
            <section className="summary-section"><div className="section-heading"><h2>Hisab-Kitab summary</h2><span>{s.period.label} · {s.period.start} to {s.period.end}</span></div><div className="metrics">
              <Metric label="Total sales (فروخت)" value={s.sales} note={`${s.counts.sales} ${s.counts.sales === 1 ? 'sale' : 'sales'}, cash and credit`} icon={ShoppingBag} />
              <Metric label="Money received (روکڑ)" value={s.received} note="Completed payments in this period" icon={Wallet} tone="neutral" />
              <Metric label="Expenses (اخراجات)" value={s.expenses} note="Operating expenses only" icon={ArrowUpRight} tone="red" />
              <Metric label="Customer udhaar (واجبات)" value={s.balances.receivables} note={`Owed to you as of ${s.balances.asOf}`} icon={Handshake} tone="red" />
            </div><div className="secondary-metrics">
              <div><Truck size={20} /><span>Supplier payables<small>You owe, as of {s.balances.asOf}</small></span><strong>{money(s.balances.payables)}</strong></div>
              <div><ShoppingBag size={20} /><span>Stock purchases<small>Goods bought in this period</small></span><strong>{money(s.purchases)}</strong></div>
              <div><ArrowUpRight size={20} /><span>Money paid<small>Completed payments in this period</small></span><strong>{money(s.paid)}</strong></div>
            </div></section>
            <div className="dashboard-columns"><div>
              <SalesExpenseChart sales={s.sales} expenses={s.expenses} range={s.period} />
              <TrendChart points={data.trends.points} />
              <section className="expense-breakdown"><div className="section-heading"><h2>Expense categories</h2><Link to="/insights">View insights <ArrowRight size={15} /></Link></div>{data.breakdown.categories.length ? data.breakdown.categories.map((c) => <div className="category-row" key={c.name}><span>{categoryLabel(c.name)} <small className="text-muted">{c.share}%</small></span><strong>{money(c.total)}</strong></div>) : <p className="empty-inline">No expenses in this period.</p>}</section>
              <section className="cash-section"><h2>Cash movement</h2><div className="cash-comparison"><div><span className="status-dot" />Received<strong>{money(s.received)}</strong></div><div><span className="status-dot outflow" />Paid<strong>{money(s.paid)}</strong></div></div>
                <p className="definition">Net cash flow: <strong>{money(s.netCashFlow)}</strong>. {s.definitions.net_cash_flow}</p>
                {s.receivedBreakdown.length > 0 && <ul className="breakdown-list">{s.receivedBreakdown.map((item) => <li key={item.key}><span>{RECEIVED_LABELS[item.key] ?? categoryLabel(item.key)}</span><strong>{money(item.amount)}</strong></li>)}</ul>}
              </section>
            </div><div>
              <section className="insight-panel"><Sparkles size={23} /><div><h2>AI Munshi</h2><p>Ask questions about your own records, or compare this period's spending with the previous one. Figures come from your saved records.</p><Link className="button ai" to="/insights">Review expense insights <ArrowRight size={16} /></Link></div></section>
              <section className="followups"><div className="section-heading"><h2>Outstanding khata</h2><Link to="/credit">View Khata <ArrowRight size={15} /></Link></div>
                <div className="balance-line"><span className="avatar red"><Handshake size={16} /></span><span>Customers owe you<small>{s.balances.openReceivableItems} open · overdue {money(s.balances.overdueReceivables)}</small></span><strong className="text-red">{money(s.balances.receivables)}</strong></div>
                <div className="balance-line"><span className="avatar indigo"><Truck size={16} /></span><span>You owe suppliers<small>{s.balances.openPayableItems} open · overdue {money(s.balances.overduePayables)}</small></span><strong>{money(s.balances.payables)}</strong></div>
              </section>
              <Link className="scan-link" to="/receipts"><ReceiptText size={21} /><span>Scan a receipt</span><ArrowRight size={18} /></Link>
              <p className="definition">{s.definitions.profit}</p>
            </div></div>
            <section className="recent-section"><div className="section-heading"><h2>Recent rokad</h2><span>Latest saved records</span></div>{s.recent.length ? <TransactionRows rows={s.recent} compact /> : <p className="empty-inline">No transactions yet.</p>}<Link className="view-all" to="/transactions">View all transactions <ArrowRight size={18} /></Link></section>
          </>}
  </>
}
