import { useState } from 'react'
import { Handshake, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import FormField from '../../components/ui/FormField'
import { withDemoPayments } from '../../services/demo'
import { money, toMinor, today } from '../transactions/model'

export default function Credit({ records, settle }) {
  const [tab, setTab] = useState('sale')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [error, setError] = useState('')
  const [review, setReview] = useState(false)
  const [notice, setNotice] = useState('')
  const rows = withDemoPayments(records).filter((row) => row.type === tab && row.party.toLowerCase().includes(search.toLowerCase()))
  const selectedRow = withDemoPayments(records).find((row) => row.id === selected)
  const open = (row) => { setSelected(row.id); setAmount(''); setError(''); setReview(false); setDate(today()) }
  function submit(e) {
    e.preventDefault()
    const value = toMinor(amount)
    if (!value || value > selectedRow.amount - selectedRow.settledPaid) return setError('Enter a positive payment no greater than the outstanding balance.')
    if (!date || date < selectedRow.date || date > today()) return setError('Choose a date between the original entry and today.')
    setError(''); setReview(true)
  }
  function confirm() {
    try { settle({ obligationId: selected, amount: toMinor(amount), date, method: 'Cash' }); setSelected(null); setNotice('Sample payment recorded and linked to the original obligation.') }
    catch (err) { setError(err.message); setReview(false) }
  }
  return <><PageHeader title="Customer & supplier khata" /><p className="subtitle">Outstanding balances and their payment history.</p>
    <div className="filter-pills" role="group" aria-label="Credit type">{[['sale', 'Customers'], ['purchase', 'Suppliers'], ['expense', 'Expense payees']].map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
    <label className="form-field narrow">Search party<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Customer or supplier name" /></label>
    {notice && <p role="status" className="success-message">{notice}</p>}
    <div className="account-list">{rows.map((row) => <article className="account-row" key={row.id}><span className={`record-icon ${tab === 'sale' ? 'green' : 'red'}`}><Handshake size={22} /></span><div><h2>{row.party}</h2><p>{row.description}</p><small>{money(row.amount)} original · {money(row.settledPaid)} settled</small></div><div className="account-balance"><strong>{money(row.amount - row.settledPaid)}</strong><span className={`badge ${row.amount === row.settledPaid ? 'green' : 'amber'}`}>{row.amount === row.settledPaid ? 'Settled' : 'Outstanding'}</span></div><button className="button" onClick={() => open(row)}>View khata</button></article>)}</div>
    {!rows.length && <p className="empty-inline">No matching accounts.</p>}
    {selectedRow && <Modal title={`${selectedRow.party} · Khata`} onClose={() => setSelected(null)}>
      <p>Outstanding: <strong>{money(selectedRow.amount - selectedRow.settledPaid)}</strong></p>
      <h3 className="small-heading">Payment history</h3>
      <ul className="history-list">{selectedRow.paid > 0 && <li>{selectedRow.date}<span>{money(selectedRow.paid)} · Initial payment</span></li>}{records.filter((row) => row.obligationId === selected).map((row) => <li key={row.id}>{row.date}<span>{money(row.amount)} · {row.method}</span></li>)}</ul>
      {!selectedRow.settledPaid && <p>No payments yet.</p>}
      {selectedRow.amount > selectedRow.settledPaid && (review ? <><p className="demo-note">Confirm {money(toMinor(amount))} in cash on {date}. This settles the existing sample balance.</p><div className="dialog-actions"><button className="button" onClick={() => setReview(false)}>Edit payment</button><button className="button primary" onClick={confirm}>Confirm sample payment</button></div></> : <form onSubmit={submit} noValidate><FormField label="Payment amount (PKR)" value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} required /><FormField label="Payment date" type="date" value={date} min={selectedRow.date} max={today()} onChange={(e) => setDate(e.target.value)} required />{error && <p role="alert" className="error-message">{error}</p>}<button className="button primary space-top" type="submit">{tab === 'sale' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}Review payment</button></form>)}
    </Modal>}
  </>
}
