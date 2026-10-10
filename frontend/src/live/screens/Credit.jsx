import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Handshake, ArrowDownLeft, ArrowUpRight, UserPlus } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import FormField from '../../components/ui/FormField'
import Feedback from '../../components/ui/Feedback'
import { money, toMinor, today } from '../../features/transactions/model'
import { PAYMENT_METHODS, PAYMENT_STATUS_LABELS, contactView, ledgerView, methodLabel } from '../../services/adapters'
import { parseMoney, toDecimalString } from '../../services/money'
import { newIdempotencyKey } from '../../services/api'
import { useLive, useResource } from '../context.js'
import { DemoTag, ErrorNotice, Loading} from '../ui'
import { fieldError } from '../errors'

export default function Credit() {
  const { api } = useLive()
  const [kind, setKind] = useState('customer')
  const [search, setSearch] = useState('')
  const [owingOnly, setOwingOnly] = useState(false)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [selected, setSelected] = useState(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState('')
  const { data, error, loading, reload } = useResource(async (signal) => (await api.listContacts({ kind, with_balance_only: owingOnly || undefined, overdue_only: overdueOnly || undefined }, { signal })).map(contactView), [kind, owingOnly, overdueOnly])
  const rows = (data ?? []).filter((row) => row.name.toLowerCase().includes(search.trim().toLowerCase()))
  const customer = kind === 'customer'
  return <>
    <PageHeader title="Customer & supplier khata" actions={<button type="button" className="button" onClick={() => setAdding(true)}><UserPlus size={17} />Add {customer ? 'customer' : 'supplier'}</button>} />
    <p className="subtitle">Balances are calculated by the server from saved records and completed payments.</p>
    <div className="filter-pills" role="group" aria-label="Contact type">{[['customer', 'Customers'], ['supplier', 'Suppliers & payees']].map(([key, label]) => <button type="button" key={key} aria-pressed={kind === key} onClick={() => { setKind(key); setSelected(null) }}>{label}</button>)}</div>
    <div className="list-toolbar">
      <label className="search"><input aria-label="Search by name" placeholder={customer ? 'Customer name' : 'Supplier name'} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <label className="check-field"><input type="checkbox" checked={owingOnly} onChange={(e) => setOwingOnly(e.target.checked)} />With balance only</label>
      <label className="check-field"><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />Overdue only</label>
    </div>
    {notice && <p role="status" className="success-message">{notice}</p>}
    <ErrorNotice error={error} onRetry={reload} title="Balances could not be loaded." />
    {!data && loading ? <Loading>Loading balances...</Loading> : rows.length ? <div className="account-list">{rows.map((row) => <article className="account-row" key={row.id}>
      <span className={`record-icon ${customer ? 'green' : 'red'}`}><Handshake size={22} /></span>
      <div><h2>{row.name} <DemoTag show={row.isDemo} /></h2><p>{row.openItems} open record{row.openItems === 1 ? '' : 's'}{row.phone ? ` · ${row.phone}` : ''}</p><small>{money(row.totalBilled)} billed · {money(row.totalSettled)} settled{row.advance ? ` · ${money(row.advance)} advance` : ''}</small></div>
      <div className="account-balance"><strong>{money(row.outstanding)}</strong><span className={`badge ${row.isOverdue ? 'red' : row.outstanding ? 'amber' : 'green'}`}>{row.isOverdue ? `Overdue ${money(row.overdue)}` : row.outstanding ? (customer ? 'Owes you' : 'You owe') : 'Settled'}</span></div>
      <button type="button" className="button" onClick={() => setSelected(row)}>View khata</button>
    </article>)}</div> : !error && !loading && <Feedback title={data?.length ? 'No matching names' : `No ${customer ? 'customers' : 'suppliers'} yet`}><p>{data?.length ? 'Try another name or clear the filters.' : `${customer ? 'Customers' : 'Suppliers'} appear here when a record names them, or you can add one.`}</p></Feedback>}
    {selected && <LedgerModal contact={selected} onClose={() => setSelected(null)} onSettled={(message) => { setNotice(message); reload() }} />}
    {adding && <AddContactModal kind={kind} onClose={() => setAdding(false)} onSaved={(name) => { setAdding(false); setNotice(`${name} added.`); reload() }} />}
  </>
}

function LedgerModal({ contact, onClose, onSettled }) {
  const { api } = useLive()
  const { data: ledger, error, reload } = useResource(async (signal) => ledgerView(await api.getContactLedger(contact.id, { signal })), [contact.id])
  const [form, setForm] = useState({ mode: contact.outstanding > 0 ? 'dues' : 'advance', amount: '', date: today(), method: 'cash', reference: '' })
  const [formError, setFormError] = useState('')
  const [review, setReview] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const current = ledger?.contact ?? contact
  const customer = current.kind === 'customer'
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  function submit(e) {
    e.preventDefault()
    const amount = toMinor(form.amount)
    if (!amount) return setFormError('Enter a positive amount with up to 2 decimal places.')
    if (form.mode === 'dues' && amount > current.outstanding) return setFormError(`This is more than the ${money(current.outstanding)} due. Record the extra as an advance separately.`)
    if (!form.date || form.date > today()) return setFormError('Choose a date that is not in the future.')
    setFormError(''); setSaveError(null)
    setReview({ amount, key: newIdempotencyKey() })
  }
  async function confirm() {
    setBusy(true); setSaveError(null)
    const common = { amount: toDecimalString(review.amount), payment_date: form.date, method: form.method, reference: form.reference.trim() || null }
    try {
      if (form.mode === 'dues') {
        const res = await api.settleContact({ contact_id: current.id, ...common }, review.key)
        setResult({ applied: parseMoney(res.amount_applied), before: parseMoney(res.outstanding_before), after: parseMoney(res.outstanding_after), count: res.payments.length })
        onSettled(`${money(parseMoney(res.amount_applied))} recorded for ${current.name}. No new sale or expense was created.`)
      } else {
        await api.createPayment({ contact_id: current.id, is_advance: true, ...common }, review.key)
        setResult({ advance: review.amount })
        onSettled(`Advance of ${money(review.amount)} recorded for ${current.name}.`)
      }
      setReview(null); setForm({ ...form, amount: '', reference: '' }); reload()
    } catch (err) { setSaveError(err) } finally { setBusy(false) }
  }

  return <Modal title={`${current.name} · Khata`} onClose={() => !busy && onClose()}>
    <p>{customer ? 'Owes you' : 'You owe'}: <strong>{money(current.outstanding)}</strong>{current.advance ? ` · Advance held: ${money(current.advance)}` : ''}</p>
    <ErrorNotice error={error} onRetry={reload} />
    {!ledger && !error && <Loading>Loading ledger...</Loading>}
    {ledger && <>
      <h3 className="small-heading">History</h3>
      {ledger.entries.length ? <ul className="history-list ledger-entries">{ledger.entries.map((entry, index) => <li key={`${entry.paymentId ?? entry.transactionId}-${index}`}>
        <span>{entry.date}<small>{entry.description}{entry.status && entry.status !== 'completed' ? ` · ${PAYMENT_STATUS_LABELS[entry.status]}` : ''}</small></span>
        <span className="history-amount"><strong className={entry.effect < 0 ? 'text-green' : ''}>{entry.effect > 0 ? '+' : ''}{money(entry.effect)}</strong><small>Balance {money(entry.runningBalance)}</small>
          {entry.transactionId && <Link to={`/transactions/${entry.transactionId}`} onClick={onClose}>Open</Link>}</span>
      </li>)}</ul> : <p className="empty-inline">No records yet.</p>}
      <p className="demo-note">{ledger.note}</p>
    </>}
    {result && <p role="status" className="success-message">{result.advance ? `Advance of ${money(result.advance)} saved.` : `Saved ${money(result.applied)} across ${result.count} record${result.count === 1 ? '' : 's'}. Balance went from ${money(result.before)} to ${money(result.after)}.`}</p>}
    <h3 className="small-heading">{customer ? 'Record money received' : 'Record payment made'}</h3>
    {review ? <>
      <p className="demo-note">{form.mode === 'dues' ? `Record ${money(review.amount)} against ${current.name}'s dues, applied to the oldest records first.` : `Record ${money(review.amount)} as an advance from ${current.name}. It will not reduce existing dues automatically.`} {methodLabel(form.method)} · {form.date}.</p>
      <ErrorNotice error={saveError} title="Not saved." />
      <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={() => setReview(null)}>Edit payment</button><button type="button" className="button primary" disabled={busy} onClick={confirm}>{busy ? 'Saving...' : 'Confirm payment'}</button></div>
    </> : <form onSubmit={submit} noValidate>
      <fieldset className="type-selector compact"><legend>Payment for</legend>
        <label className={form.mode === 'dues' ? 'selected' : ''}><input type="radio" name="mode" value="dues" disabled={!current.outstanding} checked={form.mode === 'dues'} onChange={set('mode')} />Existing dues</label>
        <label className={form.mode === 'advance' ? 'selected' : ''}><input type="radio" name="mode" value="advance" checked={form.mode === 'advance'} onChange={set('mode')} />Advance (no bill yet)</label>
      </fieldset>
      <FormField label="Payment amount (PKR)" value={form.amount} inputMode="decimal" onChange={set('amount')} required />
      <FormField label="Payment date" type="date" value={form.date} max={today()} onChange={set('date')} required />
      <label className="form-field">Method<select value={form.method} onChange={set('method')}>{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {form.method !== 'cash' && <FormField label="Reference (optional)" value={form.reference} maxLength={100} onChange={set('reference')} />}
      {formError && <p role="alert" className="error-message">{formError}</p>}
      <button className="button primary space-top" type="submit">{customer ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}Review payment</button>
    </form>}
    {current.outstanding === 0 && !current.advance && ledger?.entries.length > 0 && <p className="success-message">All records are settled.</p>}
    {ledger?.entries.some((entry) => entry.status === 'pending') && <p className="warning-message">Pending payments are listed but do not reduce the balance until completed.</p>}
  </Modal>
}

function AddContactModal({ kind, onClose, onSaved }) {
  const { api } = useLive()
  const [form, setForm] = useState({ name: '', phone: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return setError({ message: 'Enter a name.', fieldErrors: { name: 'Enter a name.' } })
    setBusy(true); setError(null)
    try { await api.createContact({ kind, name: form.name.trim(), phone: form.phone.trim() || null }); onSaved(form.name.trim()) } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return <Modal title={`Add ${kind}`} onClose={() => !busy && onClose()}>
    <form onSubmit={submit} noValidate>
      <FormField label="Name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fieldError(error, 'name')} required />
      <FormField label="Phone (optional)" type="tel" value={form.phone} maxLength={30} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={fieldError(error, 'phone')} hint="For example 03001234567" />
      {error && !fieldError(error, 'name', 'phone') && <ErrorNotice error={error} />}
      <div className="dialog-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'Saving...' : 'Add'}</button></div>
    </form>
  </Modal>
}
