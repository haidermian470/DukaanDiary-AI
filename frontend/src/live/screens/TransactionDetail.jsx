import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, Wallet } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import FormField from '../../components/ui/FormField'
import { money, toMinor, today } from '../../features/transactions/model'
import { PAYMENT_METHODS, PAYMENT_STATUS_LABELS, SETTLEMENT_LABELS, categoryLabel, methodLabel, statusTone, transactionView, typeLabel } from '../../services/adapters'
import { toDecimalString } from '../../services/money'
import { newIdempotencyKey } from '../../services/api'
import { useLive, useResource } from '../context.js'
import { DemoTag, ErrorNotice, Loading } from '../ui'

const STATUS_ACTIONS = { pending: [['completed', 'Mark received / paid'], ['failed', 'Mark failed'], ['cancelled', 'Cancel']], completed: [['cancelled', 'Reverse (e.g. bounced cheque)']] }

export default function TransactionDetail() {
  const { id } = useParams()
  const { api } = useLive()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: txn, error, loading, reload } = useResource(async (signal) => transactionView(await api.getTransaction(id, { signal })), [id])
  const [notice, setNotice] = useState(location.state?.notice ?? '')
  const [paying, setPaying] = useState(false)
  const [statusChange, setStatusChange] = useState(null)
  const [voiding, setVoiding] = useState(false)

  if (error) return <><Link className="back-link" to="/transactions"><ArrowLeft size={16} />Transactions</Link><ErrorNotice title="This transaction could not be opened." error={error} onRetry={reload} /></>
  if (!txn) return <Loading>Loading transaction...</Loading>
  const incoming = txn.type === 'sale'
  return <>
    <Link className="back-link" to="/transactions"><ArrowLeft size={16} />Transactions</Link>
    <PageHeader title={txn.description} actions={<div className="header-actions"><Link className="button" to={`/transactions/${txn.id}/edit`}><Pencil size={16} />Edit</Link><button type="button" className="button danger-outline" onClick={() => setVoiding(true)}><Trash2 size={16} />Void</button></div>} />
    <p className="subtitle">{typeLabel(txn.type)} · {categoryLabel(txn.category)} · {txn.date} <DemoTag show={txn.isDemo} /></p>
    {notice && <p role="status" className="success-message">{notice}</p>}
    {loading && <Loading>Updating...</Loading>}
    <div className="workflow-columns">
      <section>
        <div className="analytics-totals detail-totals">
          <div><span>Total</span><strong>{money(txn.amount)}</strong></div>
          <div><span>{incoming ? 'Received' : 'Paid'}</span><strong>{money(txn.paid)}</strong></div>
          <div><span>Still due</span><strong className={txn.outstanding ? 'text-red' : ''}>{money(txn.outstanding)}</strong></div>
        </div>
        <dl className="space-top">{[
          ['Status', <span key="s" className={`badge ${statusTone(txn.status)}`}>{SETTLEMENT_LABELS[txn.status]}</span>],
          [incoming ? 'Customer' : 'Supplier / payee', txn.party || 'Not specified'],
          ...(txn.dueDate ? [['Due date', `${txn.dueDate}${txn.isOverdue ? ' (overdue)' : ''}`]] : []),
          ...(txn.pending ? [['Pending payments', `${money(txn.pending)} (not counted as paid yet)`]] : []),
          ['Recorded by', { manual: 'Manual entry', ai: 'AI entry (confirmed)', voice: 'Voice entry (confirmed)', receipt: 'Receipt (confirmed)', dummy_bank: 'Dummy Bank import (demo)', demo_seed: 'Fictional demo record' }[txn.source] ?? txn.source],
          ...(txn.notes ? [['Notes', txn.notes]] : []),
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </section>
      <section className="workflow-aside">
        <h2>Payment history</h2>
        {txn.payments?.length ? <ul className="history-list wide">{txn.payments.map((p) => <li key={p.id}>
          <span>{p.date}<small>{methodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ''}{p.fromDummyBank ? ' · Dummy Bank (demo)' : ''}</small></span>
          <span className="history-amount"><strong>{money(p.amount)}</strong><span className={`badge ${statusTone(p.status)}`}>{PAYMENT_STATUS_LABELS[p.status]}</span>
            {STATUS_ACTIONS[p.status] && <select aria-label={`Change status of ${money(p.amount)} payment on ${p.date}`} value="" onChange={(e) => e.target.value && setStatusChange({ payment: p, status: e.target.value })}><option value="">Change...</option>{STATUS_ACTIONS[p.status].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
          </span></li>)}</ul> : <p className="empty-inline">No payments recorded yet.</p>}
        {txn.outstanding > 0 && <button type="button" className="button primary" onClick={() => setPaying(true)}><Wallet size={17} />{incoming ? 'Record money received' : 'Record payment made'}</button>}
        <p>A payment settles this record. It does not create a new {incoming ? 'sale' : 'expense'}.</p>
      </section>
    </div>
    {paying && <PaymentModal txn={txn} onClose={() => setPaying(false)} onSaved={(message) => { setPaying(false); setNotice(message); reload() }} />}
    {statusChange && <StatusModal change={statusChange} onClose={() => setStatusChange(null)} onSaved={(message) => { setStatusChange(null); setNotice(message); reload() }} />}
    {voiding && <VoidModal txn={txn} onClose={() => setVoiding(false)} onVoided={() => navigate('/transactions', { state: { notice: `"${txn.description}" was voided.` } })} />}
  </>
}

function PaymentModal({ txn, onClose, onSaved }) {
  const { api } = useLive()
  const [form, setForm] = useState({ amount: '', date: today(), method: 'cash', status: 'completed', reference: '' })
  const [error, setError] = useState('')
  const [review, setReview] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  function submit(e) {
    e.preventDefault()
    const amount = toMinor(form.amount)
    const room = txn.outstanding - txn.pending
    if (!amount) return setError('Enter a positive amount with up to 2 decimal places.')
    if (amount > room) return setError(`The most that can be recorded is ${money(room)}${txn.pending ? ' (pending payments already reserve part of the balance)' : ''}.`)
    if (!form.date || form.date > today() || form.date < txn.date) return setError(`Choose a date between ${txn.date} and today.`)
    setError(''); setSaveError(null)
    setReview({ amount, key: newIdempotencyKey() })
  }
  async function confirm() {
    setBusy(true); setSaveError(null)
    try {
      await api.createPayment({ transaction_id: txn.id, amount: toDecimalString(review.amount), payment_date: form.date, method: form.method, status: form.status, reference: form.reference.trim() || null }, review.key)
      onSaved(form.status === 'pending' ? `Pending payment of ${money(review.amount)} recorded. It will count once marked received.` : `Payment of ${money(review.amount)} recorded against this ${typeLabel(txn.type).toLowerCase()}.`)
    } catch (err) { setSaveError(err) } finally { setBusy(false) }
  }
  return <Modal title={txn.type === 'sale' ? 'Record money received' : 'Record payment made'} onClose={() => !busy && onClose()}>
    <p>Still due: <strong>{money(txn.outstanding)}</strong>{txn.pending ? ` · ${money(txn.pending)} pending` : ''}</p>
    {review ? <>
      <p className="demo-note">Record {money(review.amount)} by {methodLabel(form.method)} on {form.date} as {form.status}. This settles part of "{txn.description}".</p>
      <ErrorNotice error={saveError} title="Not saved." />
      <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={() => setReview(null)}>Edit</button><button type="button" className="button primary" disabled={busy} onClick={confirm}>{busy ? 'Saving...' : 'Confirm payment'}</button></div>
    </> : <form onSubmit={submit} noValidate>
      <FormField label="Amount (PKR)" inputMode="decimal" value={form.amount} onChange={set('amount')} required />
      <FormField label="Payment date" type="date" value={form.date} min={txn.date} max={today()} onChange={set('date')} required />
      <label className="form-field">Method<select value={form.method} onChange={set('method')}>{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="form-field">Status<select value={form.status} onChange={set('status')}><option value="completed">Completed (money has moved)</option><option value="pending">Pending (not received yet)</option></select></label>
      {form.method !== 'cash' && <FormField label="Reference (optional)" value={form.reference} maxLength={100} onChange={set('reference')} />}
      {error && <p role="alert" className="error-message">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Review payment</button></div>
    </form>}
  </Modal>
}

function StatusModal({ change, onClose, onSaved }) {
  const { api } = useLive()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { payment, status } = change
  const explanation = { completed: 'It will count as money received or paid.', failed: 'It will never count. This cannot be changed later.', cancelled: payment.status === 'completed' ? 'The money will no longer count and the balance will be due again.' : 'It will never count. This cannot be changed later.' }[status]
  async function confirm() {
    setBusy(true); setError(null)
    try { await api.updatePayment(payment.id, { status }); onSaved(`Payment marked ${PAYMENT_STATUS_LABELS[status].toLowerCase()}.`) } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return <Modal title={`Mark payment ${PAYMENT_STATUS_LABELS[status].toLowerCase()}?`} onClose={() => !busy && onClose()}>
    <p>{money(payment.amount)} on {payment.date} · currently {PAYMENT_STATUS_LABELS[payment.status].toLowerCase()}.</p><p>{explanation}</p>
    <ErrorNotice error={error} />
    <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Keep as is</button><button type="button" className={`button ${status === 'completed' ? 'primary' : 'destructive'}`} disabled={busy} onClick={confirm}>{busy ? 'Saving...' : 'Confirm'}</button></div>
  </Modal>
}

function VoidModal({ txn, onClose, onVoided }) {
  const { api } = useLive()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function confirm() {
    setBusy(true); setError(null)
    try { await api.voidTransaction(txn.id); onVoided() } catch (err) { setError(err); setBusy(false) }
  }
  return <Modal title="Void this transaction?" onClose={() => !busy && onClose()}>
    <p><strong>{txn.description}</strong> · {money(txn.amount)}</p>
    <p>Voiding removes this record and its payments from every total. It stays in the audit history.</p>
    <ErrorNotice error={error} />
    <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button destructive" disabled={busy} onClick={confirm}>{busy ? 'Voiding...' : 'Void transaction'}</button></div>
  </Modal>
}
