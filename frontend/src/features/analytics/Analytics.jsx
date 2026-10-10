import { useState } from 'react'
import { Download, ChartNoAxesCombined } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import DateFilter from '../../components/ui/DateFilter'
import SalesExpenseChart from '../dashboard/SalesExpenseChart'
import { demoSummary } from '../../services/demo'
import { today, periodRange, money, inRange } from '../transactions/model'

function previousRange(range) {
  const start = new Date(`${range.start}T00:00:00Z`)
  const end = new Date(`${range.end}T00:00:00Z`)
  const length = end.getTime() - start.getTime() + 86400000
  return { start: new Date(start.getTime() - length).toISOString().slice(0, 10), end: new Date(start.getTime() - 86400000).toISOString().slice(0, 10) }
}
function csvValue(value) {
  let text = String(value ?? '')
  if (/^[=+@\-\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
export default function Analytics({ records, insights = false }) {
  const [period, setPeriod] = useState('month')
  const [custom, setCustom] = useState({ start: today(), end: today() })
  const range = periodRange(period, custom)
  const valid = range.start && range.end && range.start <= range.end
  const summary = valid ? demoSummary(records, range) : null
  const priorRange = valid ? previousRange(range) : null
  const history = valid && records.some((row) => inRange(row, priorRange))
  const prior = history ? demoSummary(records, priorRange) : null
  const [notice, setNotice] = useState('')
  function download() {
    const rows = records.filter((row) => inRange(row, range))
    const csv = [['Sample data only', 'Date', 'Description', 'Party', 'Type', 'Amount PKR', 'Paid at entry PKR', 'Linked obligation'], ...rows.map((row) => ['SAMPLE', row.date, row.description, row.party, row.type, (row.amount / 100).toFixed(2), (row.paid / 100).toFixed(2), row.obligationId || ''])].map((row) => row.map(csvValue).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `dukaandiary-sample-${range.start}-${range.end}.csv`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('Sample CSV download requested.')
  }
  return <><PageHeader title={insights ? 'Expense insights' : 'Reports'} actions={!insights && <button className="button" onClick={download} disabled={!valid}><Download size={17} />Export sample CSV</button>} /><p className="subtitle">{insights ? 'Spending patterns grounded in your sample ledger.' : 'Sales, purchases, expenses, and cash movement shown separately.'}</p><DateFilter period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />{notice && <p role="status" className="success-message">{notice}</p>}{!valid ? <p role="alert" className="error-message">Choose a valid date range.</p> : <>
      <div className="analytics-totals">{(insights ? [['Operating expenses', summary.expenses]] : [['Sales', summary.sales], ['Purchases', summary.purchases], ['Operating expenses', summary.expenses], ['Money received', summary.received], ['Money paid', summary.paid], ['Receivables at period end', summary.receivables], ['Payables at period end', summary.payables]]).map(([label, amount]) => <div key={label}><span>{label}</span><strong>{money(amount)}</strong></div>)}</div>
      <div className="workflow-columns"><section>{!insights && <SalesExpenseChart sales={summary.sales} expenses={summary.expenses} range={range} />}<div className="section-heading space-top"><h2>Category spending</h2><span>{range.start} to {range.end}</span></div>{summary.categories.length ? [...summary.categories].sort((a, b) => b.value - a.value).map((category) => <div className="category-row" key={category.name}><span>{category.name}</span><strong>{money(Math.round(category.value * 100))}</strong></div>) : <p className="empty-inline">No operating expenses in this period.</p>}</section><section className="workflow-aside"><ChartNoAxesCombined size={25} className="text-indigo" /><h2>Previous equivalent period</h2><p>{priorRange.start} to {priorRange.end}</p>{prior ? <><dl><div><dt>Previous expenses</dt><dd>{money(prior.expenses)}</dd></div><div><dt>Difference</dt><dd>{money(summary.expenses - prior.expenses)}</dd></div></dl><p>{prior.expenses ? `${((summary.expenses - prior.expenses) / prior.expenses * 100).toFixed(1)}% change in recorded sample expenses.` : 'Percentage change is not meaningful when the previous total is zero.'}</p></> : <p className="demo-note">Insufficient historical records for a meaningful comparison. A missing period is not treated as zero spending.</p>}<h2>Unusual spending</h2><p>There is not enough historical category data to establish a normal spending baseline.</p>{summary.categories.length > 0 && <><h2>Review suggestion</h2><p>Review {summary.categories.reduce((best, item) => item.value > best.value ? item : best).name.toLowerCase()} receipts first: this is the highest-spending category in the selected sample period. No savings estimate has been assumed.</p></>}</section></div>
    </>}</>
}
