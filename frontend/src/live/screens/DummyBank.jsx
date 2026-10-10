import { useState } from 'react'
import { Landmark, Download, FlaskConical } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import FormField from '../../components/ui/FormField'
import { money, toMinor } from '../../features/transactions/model'
import { PAYMENT_STATUS_LABELS, bankTransactionView, contactView, pageView, statusTone, transactionView, typeLabel } from '../../services/adapters'
import { toDecimalString } from '../../services/money'
import { useLive, useResource } from '../context.js'
import { ErrorNotice, Loading } from '../ui'

const when = (iso) => new Date(iso).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' })

export default function DummyBank() {
  const { api } = useLive()
  const [status, setStatus] = useState('')
  const [direction, setDirection] = useState('')
  const [notImported, setNotImported] = useState(false)
  const [selected, setSelected] = useState(null)
  const [notice, setNotice] = useState('')
  const accounts = useResource(async (signal) => api.bankAccounts({ signal }), [])
  const list = useResource(async (signal) => (await api.bankTransactions({ status, direction, not_imported_only: notImported || undefined }, { signal })).map(bankTransactionView), [status, direction, notImported])
  const account = accounts.data?.[0]
  const refresh = (message) => { if (message) setNotice(message); list.reload() }

  return <><PageHeader title="Dummy Bank" /><p className="bank-warning"><Landmark size={19} />DEMO — NO REAL BANK CONNECTION</p>
    <p className="subtitle">{account ? `${account.bank_name} · ${account.account_title} · ${account.account_number_masked}` : 'Synthetic demo account'}. All data here is made up for testing.</p>
    <ErrorNotice error={accounts.error} onRetry={accounts.reload} />
    <div className="list-toolbar">
      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(PAYMENT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Direction<select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="">In and out</option><option value="in">Money in</option><option value="out">Money out</option></select></label>
      <label className="check-field"><input type="checkbox" checked={notImported} onChange={(e) => setNotImported(e.target.checked)} />Not yet recorded</label>
    </div>
    {notice && <p role="status" className="success-message">{notice}</p>}
    <ErrorNotice error={list.error} onRetry={list.reload} title="Demo bank records could not be loaded." />
    {!list.data && list.loading ? <Loading>Loading demo bank records...</Loading> : list.data && (list.data.length ? <div className="account-list">{list.data.map((row) => <article className="account-row" key={row.id}>
      <span className="record-icon indigo"><Landmark size={22} /></span>
      <div><h2>{row.party}</h2><p>{row.reference} · {when(row.occurredAt)}</p><small>{row.direction === 'in' ? 'Money in' : 'Money out'}{row.description ? ` · ${row.description}` : ''}</small></div>
      <div className="account-balance"><strong>{money(row.amount)}</strong><span className={`badge ${statusTone(row.status)}`}>{PAYMENT_STATUS_LABELS[row.status]}</span></div>
      <button type="button" className="button" disabled={row.imported || row.status !== 'completed'} onClick={() => setSelected(row)} title={row.status !== 'completed' ? 'Only completed transfers can be recorded' : undefined}><Download size={17} />{row.imported ? 'Recorded' : 'Record'}</button>
    </article>)}</div> : <p className="empty-inline">No demo bank records match.</p>)}
    <p className="demo-note">Only completed transfers can be recorded in your books, and each one only once. Pending is not the same as completed.</p>
    <DemoControls rows={list.data ?? []} onChanged={refresh} />
    {selected && <ImportModal bank={selected} onClose={() => setSelected(null)} onImported={(message) => { setSelected(null); refresh(message) }} />}
  </>
}

function ImportModal({ bank, onClose, onImported }) {
  const { api } = useLive()
  const incoming = bank.direction === 'in'
  const kind = incoming ? 'customer' : 'supplier'
  const [mode, setMode] = useState('settle_transaction')
  const [transactionId, setTransactionId] = useState('')
  const [contactId, setContactId] = useState('')
  const [newTxn, setNewTxn] = useState({ type: incoming ? 'sale' : 'expense', description: `${incoming ? 'Payment from' : 'Payment to'} ${bank.party}`, category: '', contact_name: bank.party })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const open = useResource(async (signal) => {
    const types = incoming ? ['sale'] : ['purchase', 'expense']
    const pages = await Promise.all(types.flatMap((type) => ['unpaid', 'partially_paid'].map((settlement_status) => api.listTransactions({ type, settlement_status, page_size: 100 }, { signal }))))
    const rows = pages.flatMap((page) => pageView(page, transactionView).items)
    const sameName = (row) => row.party.trim().toLowerCase() === bank.party.trim().toLowerCase()
    return rows.sort((a, b) => Number(sameName(b)) - Number(sameName(a)) || a.date.localeCompare(b.date))
  }, [bank.id])
  const contacts = useResource(async (signal) => (await api.listContacts({ kind, with_balance_only: true }, { signal })).map(contactView), [kind])
  const chosen = open.data?.find((row) => row.id === transactionId)
  const chosenContact = contacts.data?.find((c) => c.id === contactId)
  const tooMuch = (mode === 'settle_transaction' && chosen && bank.amount > chosen.outstanding - chosen.pending) || (mode === 'settle_contact' && chosenContact && bank.amount > chosenContact.outstanding)
  const ready = mode === 'settle_transaction' ? Boolean(chosen) : mode === 'settle_contact' ? Boolean(chosenContact) : newTxn.description.trim().length > 0

  async function confirm() {
    setBusy(true); setError(null)
    const body = mode === 'settle_transaction' ? { mode, transaction_id: transactionId }
      : mode === 'settle_contact' ? { mode, contact_id: contactId }
        : { mode, new_transaction: { type: newTxn.type, description: newTxn.description.trim(), category: newTxn.category.trim() || null, contact_name: newTxn.contact_name.trim() || null } }
    try {
      const result = await api.importBankTransaction(bank.id, body)
      onImported(result.message || 'Demo transfer recorded.')
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  return <Modal title="Record demo bank transfer" onClose={() => !busy && onClose()}>
    <p className="bank-warning compact">DEMO — NO REAL BANK CONNECTION</p>
    <p><strong>{bank.party}</strong> · {money(bank.amount)} {incoming ? 'received' : 'paid'} · {bank.reference}</p>
    <fieldset className="choice-list"><legend>What was this money for?</legend>
      <label><input type="radio" name="mode" value="settle_transaction" checked={mode === 'settle_transaction'} onChange={() => setMode('settle_transaction')} />It pays an existing {incoming ? 'sale' : 'purchase or expense'}</label>
      <label><input type="radio" name="mode" value="settle_contact" checked={mode === 'settle_contact'} onChange={() => setMode('settle_contact')} />It pays a {kind}'s old dues (oldest first)</label>
      <label><input type="radio" name="mode" value="new_transaction" checked={mode === 'new_transaction'} onChange={() => setMode('new_transaction')} />It is a new, fully paid {incoming ? 'sale' : 'purchase or expense'}</label>
    </fieldset>
    {mode === 'settle_transaction' && (open.error ? <ErrorNotice error={open.error} onRetry={open.reload} /> : !open.data ? <Loading /> : open.data.length ? <label className="form-field">Record being paid<select value={transactionId} onChange={(e) => setTransactionId(e.target.value)}><option value="">Choose a record</option>{open.data.map((row) => <option key={row.id} value={row.id}>{row.party || 'No name'} · {row.description} · {money(row.outstanding)} due · {row.date}</option>)}</select></label> : <p className="warning-message">There are no unpaid {incoming ? 'sales' : 'purchases or expenses'}.</p>)}
    {mode === 'settle_contact' && (contacts.error ? <ErrorNotice error={contacts.error} onRetry={contacts.reload} /> : !contacts.data ? <Loading /> : contacts.data.length ? <label className="form-field">{incoming ? 'Customer' : 'Supplier'}<select value={contactId} onChange={(e) => setContactId(e.target.value)}><option value="">Choose a name</option>{contacts.data.map((c) => <option key={c.id} value={c.id}>{c.name} · {money(c.outstanding)} due</option>)}</select></label> : <p className="warning-message">No {kind}s have dues.</p>)}
    {mode === 'new_transaction' && <div className="form-grid single">
      {!incoming && <label className="form-field">Type<select value={newTxn.type} onChange={(e) => setNewTxn({ ...newTxn, type: e.target.value })}><option value="expense">{typeLabel('expense')}</option><option value="purchase">{typeLabel('purchase')}</option></select></label>}
      <FormField label="Description" value={newTxn.description} maxLength={500} onChange={(e) => setNewTxn({ ...newTxn, description: e.target.value })} required />
      <FormField label="Category (optional)" value={newTxn.category} maxLength={60} onChange={(e) => setNewTxn({ ...newTxn, category: e.target.value })} />
      <FormField label={incoming ? 'Customer' : 'Supplier / payee'} value={newTxn.contact_name} maxLength={120} onChange={(e) => setNewTxn({ ...newTxn, contact_name: e.target.value })} />
    </div>}
    {tooMuch && <p className="warning-message">The transfer is larger than the amount due. The server will refuse an overpayment.</p>}
    <p className="demo-note">{mode === 'new_transaction' ? `This creates a new ${typeLabel(newTxn.type).toLowerCase()} that is already paid.` : 'This records a payment only. No new sale or expense is created.'} Each demo transfer can be recorded once.</p>
    <ErrorNotice error={error} title="Not recorded." />
    <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button primary" disabled={!ready || busy} onClick={confirm}>{busy ? 'Recording...' : 'Confirm and record'}</button></div>
  </Modal>
}

function DemoControls({ rows, onChanged }) {
  const { api } = useLive()
  const [form, setForm] = useState({ amount: '', counterparty: '', reference: '', direction: 'in', status: 'completed' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [formError, setFormError] = useState('')
  const pending = rows.filter((row) => row.status === 'pending')
  async function simulate(e) {
    e.preventDefault()
    const amount = toMinor(form.amount)
    if (!amount || !form.counterparty.trim()) return setFormError('Enter an amount and a name.')
    if (form.reference.trim() && form.reference.trim().length < 3) return setFormError('A reference needs at least 3 characters, or leave it empty.')
    setFormError(''); setBusy(true); setError(null)
    try {
      const row = await api.simulateIncoming({ amount: toDecimalString(amount), counterparty_name: form.counterparty.trim(), reference: form.reference.trim() || null, direction: form.direction, status: form.status })
      setForm({ ...form, amount: '', reference: '' })
      onChanged(`Demo transfer ${row.reference} created (${PAYMENT_STATUS_LABELS[row.status].toLowerCase()}).`)
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  async function changeStatus(row, status) {
    setBusy(true); setError(null)
    try { await api.simulateStatus(row.id, status); onChanged(`Demo transfer ${row.reference} is now ${PAYMENT_STATUS_LABELS[status].toLowerCase()}.`) } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return <details className="demo-controls space-top"><summary><FlaskConical size={17} />Demo controls (synthetic only)</summary>
    <p className="demo-note">For presentations: make a fake transfer arrive, or move a pending one forward. None of this touches a real bank.</p>
    <form onSubmit={simulate} noValidate className="form-grid">
      <FormField label="Amount (PKR)" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
      <FormField label="Name" value={form.counterparty} maxLength={120} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} />
      <FormField label="Reference (optional)" value={form.reference} maxLength={64} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
      <label className="form-field">Direction<select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value="in">Money in</option><option value="out">Money out</option></select></label>
      <label className="form-field">Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="completed">Completed</option><option value="pending">Pending</option></select></label>
      <div className="form-field"><span aria-hidden="true">&nbsp;</span><button type="submit" className="button" disabled={busy}>Create demo transfer</button></div>
    </form>
    {formError && <p role="alert" className="error-message">{formError}</p>}
    {pending.length > 0 && <><h3 className="small-heading">Pending demo transfers</h3><ul className="history-list wide">{pending.map((row) => <li key={row.id}><span>{row.party}<small>{row.reference} · {money(row.amount)}</small></span><span className="history-amount"><button type="button" className="button compact" disabled={busy} onClick={() => changeStatus(row, 'completed')}>Complete</button><button type="button" className="button compact" disabled={busy} onClick={() => changeStatus(row, 'failed')}>Fail</button></span></li>)}</ul></>}
    <ErrorNotice error={error} />
  </details>
}
