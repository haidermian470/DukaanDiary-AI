import { useState } from 'react'
import { Landmark, Download } from 'lucide-react'
import { demoBankRecords, withDemoPayments } from '../../services/demo'
import { money } from '../transactions/model'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'

export default function DummyBank({ records, importBank }) {
  const [bank] = useState(demoBankRecords)
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState(null)
  const [obligation, setObligation] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const eligible = selected ? withDemoPayments(records).filter((row) => row.party === selected.party && (selected.direction === 'incoming' ? row.type === 'sale' : ['purchase', 'expense'].includes(row.type)) && row.amount - row.settledPaid >= selected.amount) : []
  function confirm() {
    try { importBank(selected, obligation); setSelected(null); setNotice('Demo bank payment imported and linked. No new sale or expense was created.') } catch (err) { setError(err.message) }
  }
  return <><PageHeader title="Dummy Bank" /><p className="bank-warning"><Landmark size={19} />DEMO — NO REAL BANK CONNECTION</p><p className="subtitle">Synthetic account: Bismillah Demo · DEMO-0001</p>
    <label className="form-field narrow">Transaction status<select value={status} onChange={(e) => setStatus(e.target.value)}>{['all', 'completed', 'pending', 'failed'].map((value) => <option key={value} value={value}>{value === 'all' ? 'All statuses' : value}</option>)}</select></label>
    {notice && <p role="status" className="success-message">{notice}</p>}
    <div className="account-list">{bank.filter((row) => status === 'all' || row.status === status).map((row) => {
      const imported = records.some((entry) => entry.bankId === row.id)
      return <article className="account-row" key={row.id}><span className="record-icon indigo"><Landmark size={22} /></span><div><h2>{row.party}</h2><p>{row.reference} · {row.date}</p><small>{row.direction}</small></div><div className="account-balance"><strong>{money(row.amount)}</strong><span className={`badge ${row.status === 'completed' ? 'green' : row.status === 'pending' ? 'amber' : 'red'}`}>{row.status}</span></div><button className="button" disabled={imported || row.status !== 'completed'} onClick={() => { setSelected(row); setObligation(''); setError('') }}><Download size={17} />{imported ? 'Imported' : 'Import'}</button></article>
    })}</div>
    {selected && <Modal title="Review demo bank import" onClose={() => setSelected(null)}><p>{selected.party} · {money(selected.amount)}</p><p>{selected.reference}</p><label className="form-field space-top">Link to existing obligation<select value={obligation} onChange={(e) => setObligation(e.target.value)}><option value="">Choose a matching balance</option>{eligible.map((row) => <option key={row.id} value={row.id}>{row.description} · {money(row.amount - row.settledPaid)} outstanding</option>)}</select></label>{!eligible.length && <p className="warning-message">No eligible balance for this party and amount.</p>}<p className="demo-note">This synthetic payment settles an existing balance. It does not create new revenue.</p>{error && <p role="alert" className="error-message">{error}</p>}<div className="dialog-actions"><button className="button" onClick={() => setSelected(null)}>Cancel</button><button className="button primary" disabled={!obligation} onClick={confirm}>Confirm sample import</button></div></Modal>}
  </>
}
