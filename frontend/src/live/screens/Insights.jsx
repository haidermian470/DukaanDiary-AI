import { useState } from 'react'
import { ChartNoAxesCombined, ArrowUp, ArrowDown, AlertTriangle, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import { money } from '../../features/transactions/model'
import { categoryLabel, insightsView } from '../../services/adapters'
import { useLive, useResource } from '../context.js'
import { ErrorNotice, Loading } from '../ui'

const PERIODS = [['this_week', 'This week'], ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month'], ['last_7_days', 'Last 7 days'], ['last_30_days', 'Last 30 days']]
const percent = (value) => (value === null || value === undefined ? 'No baseline' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`)

export default function Insights() {
  const { api } = useLive()
  const [period, setPeriod] = useState('this_month')
  const [includePurchases, setIncludePurchases] = useState(false)
  const { data: d, error, loading, reload } = useResource(async (signal) => insightsView(await api.expenseInsights({ period, include_purchases: includePurchases }, { signal })), [period, includePurchases])
  return <>
    <PageHeader title="Expense insights" />
    <p className="subtitle">Spending compared with the previous equivalent period, from your saved records.</p>
    <div className="filter-pills" role="group" aria-label="Period">{PERIODS.map(([value, label]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}</div>
    <label className="check-field"><input type="checkbox" checked={includePurchases} onChange={(e) => setIncludePurchases(e.target.checked)} />Include stock purchases</label>
    <ErrorNotice error={error} onRetry={reload} title={error?.status === 429 ? 'Too many requests.' : 'Insights could not be loaded.'} />
    {!d && loading && <Loading>Comparing your spending...</Loading>}
    {d && <>
      {loading && <Loading>Updating...</Loading>}
      <div className="analytics-totals">
        <div><span>{d.period.label} ({d.period.start} to {d.period.end})</span><strong>{money(d.totalCurrent)}</strong></div>
        <div><span>Previous ({d.previousPeriod.start} to {d.previousPeriod.end})</span><strong>{money(d.totalPrevious)}</strong></div>
        <div><span>Change</span><strong className={d.change > 0 ? 'text-red' : ''}>{money(d.change)} <small>{percent(d.changePercent)}</small></strong></div>
      </div>
      {d.notes.map((note) => <p key={note} className="info-message">{note}</p>)}
      <div className="workflow-columns">
        <section>
          <div className="section-heading space-top"><h2>Categories</h2><span>Current · previous · change</span></div>
          {d.categories.length ? <div className="table-scroll"><table className="data-table"><caption className="visually-hidden">Spending by category</caption><thead><tr><th scope="col">Category</th><th scope="col">Current</th><th scope="col">Previous</th><th scope="col">Change</th></tr></thead><tbody>{d.categories.map((c) => <tr key={c.category}><th scope="row">{categoryLabel(c.category)}{d.topCategory === c.category ? <span className="badge indigo">Top</span> : null}</th><td>{money(c.current)}</td><td>{money(c.previous)}</td><td className={c.change > 0 ? 'text-red' : c.change < 0 ? 'text-green' : ''}>{c.change > 0 ? <ArrowUp size={13} aria-hidden="true" /> : c.change < 0 ? <ArrowDown size={13} aria-hidden="true" /> : null}{money(c.change)} <small>{percent(c.percent)}</small></td></tr>)}</tbody></table></div> : <p className="empty-inline">No spending recorded in either period.</p>}
          <h2 className="space-top"><AlertTriangle size={18} className="inline-icon" /> Unusual expenses</h2>
          {d.unusual.length ? d.unusual.map((u) => <div className="category-row" key={u.id}><span><Link to={`/transactions/${u.id}`}>{u.description}</Link><small className="text-muted"> · {categoryLabel(u.category)} · {u.date} · typical {money(u.typical)}</small></span><strong>{money(u.amount)} <small>({u.times.toFixed(1)}×)</small></strong></div>)
            : <p className="empty-inline">Nothing unusual by the rule below.</p>}
          <p className="demo-note">Unusual means higher than usual for that category. It is a prompt to check the receipt, not proof of a mistake or fraud.</p>
        </section>
        <section className="workflow-aside">
          <Sparkles size={25} className="text-indigo" />
          <h2>Summary</h2>
          <p>{d.summary}</p>
          {d.suggestions.length > 0 && <><h2>Suggestions</h2><ul className="plain-list">{d.suggestions.map((s) => <li key={s}>{s}</li>)}</ul></>}
          <p className="demo-note">{d.aiGenerated ? 'Wording written by AI from the figures above' : 'Template wording (AI was not used)'}{d.grounding === 'failed_fallback_used' ? '. The AI text mentioned figures that were not in your records, so it was replaced.' : '.'} All amounts come from your saved records.</p>
          <ChartNoAxesCombined size={22} className="text-indigo" />
          <h2>How this is calculated</h2>
          <dl className="rules">{Object.entries(d.rules).map(([name, rule]) => <div key={name}><dt>{categoryLabel(name.replaceAll('_', ' '))}</dt><dd>{rule}</dd></div>)}</dl>
        </section>
      </div>
    </>}
  </>
}
