import { useId } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { money } from '../transactions/model'

export default function SalesExpenseChart({ sales, expenses, range }) {
  const id = useId().replace(/:/g, '')
  const entries = [{ name: 'Sales', value: sales, tone: 'sales' }, { name: 'Operating expenses', value: expenses, tone: 'expenses' }]
  const slices = entries.filter((entry) => entry.value > 0)

  return <section className="chart-section sales-expense-chart">
    <div className="section-heading"><div><h2>Sales vs expenses</h2><p>{range.start} to {range.end}</p></div></div>
    {slices.length ? <>
      <div className="donut-stage" role="img" aria-label={`Sales ${money(sales)}; operating expenses ${money(expenses)} for the selected period.`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              <linearGradient id={`${id}-sales`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#34d399" /><stop offset="100%" stopColor="#047857" /></linearGradient>
              <linearGradient id={`${id}-expenses`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#fb8b82" /><stop offset="100%" stopColor="#cf1b1e" /></linearGradient>
            </defs>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="88%" startAngle={90} endAngle={-270} paddingAngle={slices.length > 1 ? 4 : 0} cornerRadius={6} stroke="none" isAnimationActive={false}>
              {slices.map((entry) => <Cell key={entry.tone} fill={`url(#${id}-${entry.tone})`} />)}
            </Pie>
            <Tooltip formatter={(value) => money(Number(value))} contentStyle={{ borderRadius: 10, border: '1px solid #e2e6ee', fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center" aria-hidden="true"><span>Hisab-Kitab</span><strong>Sales &amp;<br />expenses</strong><small>PKR</small></div>
      </div>
      <dl className="donut-legend">{entries.map((entry) => <div key={entry.tone}><dt><span className={`chart-swatch ${entry.tone}`} />{entry.name}</dt><dd>{money(entry.value)}</dd></div>)}</dl>
    </> : <p className="empty-inline">No sales or expenses in this period.</p>}
  </section>
}
