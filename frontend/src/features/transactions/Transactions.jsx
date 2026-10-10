import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import DateFilter from '../../components/ui/DateFilter'
import Modal from '../../components/ui/Modal'
import Feedback from '../../components/ui/Feedback'
import PageHeader from '../../components/ui/PageHeader'
import TransactionList from './TransactionList'
import { inRange, periodRange, today, typeLabels, money } from './model'
import { withDemoPayments } from '../../services/demo'

export default function Transactions({ records, remove, notice }) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [period, setPeriod] = useState('all')
  const [custom, setCustom] = useState({ start: today(), end: today() })
  const [deleting, setDeleting] = useState(null)
  const range = periodRange(period, custom)
  const validRange = period !== 'custom' || (custom.start && custom.end && custom.start <= custom.end)
  const filtered = validRange ? withDemoPayments(records).filter((row) => inRange(row, range) && (type === 'all' || row.type === type) && `${row.description} ${row.party} ${row.category}`.toLowerCase().includes(query.toLowerCase())) : []
  const linked = deleting && records.some((row) => row.obligationId === deleting.id)
  return <>
    <PageHeader title="Transactions" actions={<Link className="button primary" to="/transactions/new"><Plus size={18} />Add transaction</Link>} />
    <p className="subtitle">Your daily rokad, purchases, expenses, and linked payments.</p>
    {notice && <p role="status" className="success-message">{notice}</p>}
    <DateFilter period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} allowAll />
    <div className="list-toolbar"><label className="search"><Search size={18} /><input aria-label="Search transactions" placeholder="Search description, party, or category" value={query} onChange={(e) => setQuery(e.target.value)} /></label><label>Type<select value={type} onChange={(e) => setType(e.target.value)}><option value="all">All types</option>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    <div className="section-heading"><h2>Transaction history</h2><span>{filtered.length} records</span></div>
    {filtered.length ? <TransactionList records={filtered} onDelete={setDeleting} /> : <Feedback title="No matching transactions"><p>Try another search or date range.</p><button className="button" onClick={() => { setQuery(''); setType('all'); setPeriod('all') }}>Clear filters</button></Feedback>}
    {deleting && <Modal title={linked ? 'Linked payment exists' : 'Delete sample transaction?'} onClose={() => setDeleting(null)}><p>{deleting.description} · {money(deleting.amount)}</p><p>{linked ? 'This transaction has a payment history. Deletion is blocked to preserve the linked balance.' : 'This removes the transaction from this sample workspace only.'}</p><div className="dialog-actions"><button className="button" onClick={() => setDeleting(null)}>Cancel</button>{!linked && <button className="button destructive" onClick={() => { remove(deleting.id); setDeleting(null) }}>Delete transaction</button>}</div></Modal>}
  </>
}
