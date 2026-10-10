import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { money } from '../../features/transactions/model'

// Chart values are converted from paisa to rupees only for drawing; labels use exact amounts.
export default function TrendChart({ points, title = 'Sales and expenses over time' }) {
  if (points.length < 2) return null
  const data = points.map((p) => ({ label: p.start === p.end ? p.start.slice(5) : `${p.start.slice(5)}–${p.end.slice(5)}`, sales: p.sales / 100, expenses: p.expenses / 100, salesMinor: p.sales, expensesMinor: p.expenses }))
  const summary = data.map((d) => `${d.label}: sales ${money(d.salesMinor)}, expenses ${money(d.expensesMinor)}`).join('; ')
  return <section className="trend-section">
    <h2>{title}</h2>
    <div className="trend-stage" role="img" aria-label={`${title}. ${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#e2e6ee" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={56} />
          <Tooltip formatter={(_value, name, item) => money(name === 'Sales' ? item.payload.salesMinor : item.payload.expensesMinor)} contentStyle={{ borderRadius: 10, border: '1px solid #e2e6ee', fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="sales" name="Sales" fill="#047857" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="expenses" name="Expenses" fill="#cf1b1e" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </section>
}
