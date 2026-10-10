import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PlusCircle, TrendingDown, ShieldCheck, Mic, Store, ShoppingBag, Wallet, ArrowUpRight, Handshake, Truck, Sparkles, ArrowRight, ReceiptText } from 'lucide-react'
import SalesExpenseChart from './SalesExpenseChart'
import DateFilter from '../../components/ui/DateFilter'
import TransactionList from '../transactions/TransactionList'
import { today, periodRange, inRange, money } from '../transactions/model'
import { demoSummary, withDemoPayments } from '../../services/demo'

function Metric({ label, value, note, icon: Icon, tone = 'green' }) {
  return <article className="metric"><div className="metric-label"><span>{label}</span><span className={`mini-icon ${tone}`}><Icon size={17} /></span></div><strong className={`metric-value text-${tone}`}>{money(value)}</strong><small>{note}</small></article>
}
export default function Dashboard({ records, profile }) {
  const [period, setPeriod] = useState('today')
  const [custom, setCustom] = useState({ start: today(), end: today() })
  const range = periodRange(period, custom)
  const summary = demoSummary(records, range)
  const recent = withDemoPayments(records.filter((row) => !range.end || row.date <= range.end)).filter((row) => inRange(row, range)).slice(0, 5)
  const validRange = period !== 'custom' || (custom.start && custom.end && custom.start <= custom.end)
  return <>
    <div className="greeting"><div><h1>Assalam-o-Alaikum,<br className="mobile-break" /> {profile.name}!</h1><p><Store size={15} /> {profile.store} · Karachi</p></div><span className="badge neutral">Sample workspace</span></div>
    <DateFilter period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />
    <div className="quick-actions">{[
      ['/transactions/new?type=sale', 'Record sale', 'فروخت اندراج', PlusCircle, 'green'], ['/transactions/new?type=expense', 'Record expense', 'خرچہ اندراج', TrendingDown, 'red'], ['/payment-check', 'AI Tasdeeq', 'ادائیگی کی جانچ', ShieldCheck, 'indigo'], ['/voice', 'Voice Khata', 'آواز سے لکھیں', Mic, 'neutral'],
    ].map(([path, label, urdu, Icon, tone]) => <Link key={path} to={path} className="quick-action"><span className={`record-icon ${tone}`}><Icon size={23} /></span><span><strong>{label}</strong><small lang="ur" dir="rtl">{urdu}</small></span></Link>)}</div>
    {!validRange ? <p role="alert" className="error-message">Select a valid date range to view the summary.</p> : <>
      <section className="summary-section"><div className="section-heading"><h2>Hisab-Kitab summary</h2><span>PKR · Sample records</span></div><div className="metrics">
        <Metric label="Total sales (فروخت)" value={summary.sales} note="Sales recorded in this period" icon={ShoppingBag} />
        <Metric label="Cash received (روکڑ)" value={summary.received} note="Cash + digital payments" icon={Wallet} tone="neutral" />
        <Metric label="Expenses (اخراجات)" value={summary.expenses} note="Operating expenses only" icon={ArrowUpRight} tone="red" />
        <Metric label="Customer udhaar (واجبات)" value={summary.receivables} note="Outstanding as of period end" icon={Handshake} tone="red" />
      </div><div className="secondary-metrics"><div><Truck size={20} /><span>Supplier payables<small>Outstanding as of period end</small></span><strong>{money(summary.payables)}</strong></div><div><ShoppingBag size={20} /><span>Purchases<small>Goods acquired in this period</small></span><strong>{money(summary.purchases)}</strong></div><div><ArrowUpRight size={20} /><span>Money paid<small>Cash + digital payments</small></span><strong>{money(summary.paid)}</strong></div></div></section>
      <div className="dashboard-columns"><div><SalesExpenseChart sales={summary.sales} expenses={summary.expenses} range={range} />
      <section className="expense-breakdown"><div className="section-heading"><h2>Expense categories</h2><Link to="/insights">View insights <ArrowRight size={15} /></Link></div>{summary.categories.length ? summary.categories.map((category) => <div className="category-row" key={category.name}><span>{category.name}</span><strong>{money(Math.round(category.value * 100))}</strong></div>) : <p className="empty-inline">No expenses in this period.</p>}</section>
      <section className="cash-section"><h2>Cash movement</h2><div className="cash-comparison"><div><span className="status-dot" />Received<strong>{money(summary.received)}</strong></div><div><span className="status-dot outflow" />Paid<strong>{money(summary.paid)}</strong></div></div></section></div>
      <div><section className="insight-panel"><Sparkles size={23} /><div><h2>AI Munshi insight <span className="badge indigo">Sample</span></h2><p>{summary.categories.length ? `Your sample records show ${money(summary.expenses)} in operating expenses for this period. More history is needed for a meaningful period comparison.` : 'There are no sample expenses for this period.'}</p><Link className="button ai" to="/insights">Review expense insights <ArrowRight size={16} /></Link></div></section>
      <section className="followups"><div className="section-heading"><h2>Outstanding khata</h2><Link to="/credit">View Khata <ArrowRight size={15} /></Link></div><div className="balance-line"><span className="avatar red">AR</span><span>Customer balances<small>After linked repayments</small></span><strong className="text-red">{money(summary.receivables)}</strong></div><div className="balance-line"><span className="avatar indigo">RW</span><span>Supplier balances<small>After payments made</small></span><strong>{money(summary.payables)}</strong></div></section>
      <Link className="scan-link" to="/receipts"><ReceiptText size={21} /><span>Scan a receipt</span><ArrowRight size={18} /></Link></div></div>
      <section className="recent-section"><div className="section-heading"><h2>Recent rokad</h2><span>Sample ledger</span></div>{recent.length ? <TransactionList records={recent} compact /> : <p className="empty-inline">No transactions in this period.</p>}<Link className="view-all" to="/transactions">View all transactions <ArrowRight size={18} /></Link></section>
    </>}
  </>
}
