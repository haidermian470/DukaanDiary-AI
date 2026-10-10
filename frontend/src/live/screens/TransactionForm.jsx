import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import FormField from '../../components/ui/FormField'
import PageHeader from '../../components/ui/PageHeader'
import { today, toMinor, money, validateTransaction } from '../../features/transactions/model'
import { PAYMENT_METHODS, TRANSACTION_TYPES, categoryLabel, mergeDraft, methodLabel, transactionCreateBody, transactionFormValues, transactionUpdateBody, transactionView, typeLabel } from '../../services/adapters'
import { newIdempotencyKey } from '../../services/api'
import { useLive, useResource } from '../context.js'
import { ErrorNotice, Loading} from '../ui'
import { fieldError } from '../errors'

const CATEGORIES = ['Groceries', 'Inventory', 'Stock', 'Utilities', 'Rent', 'Salaries', 'Transport', 'Repairs', 'Other']
const FIELD_MAP = { amount: ['amount'], paid: ['amount_paid'], description: ['description'], category: ['category'], date: ['transaction_date'], dueDate: ['due_date'], party: ['contact_name', 'contact_id'], method: ['payment_method'], notes: ['notes'], reference: ['payment_reference'] }

function blankForm(params) {
  const type = ['sale', 'purchase', 'expense'].includes(params.get('type')) ? params.get('type') : 'sale'
  return { type, description: '', party: '', contactId: '', amount: '', paid: '0', date: today(), dueDate: '', category: '', method: 'cash', reference: '', notes: '', source: 'manual' }
}

export default function TransactionForm() {
  const { id } = useParams()
  const { api } = useLive()
  const { data: original, error, reload } = useResource(id ? async (signal) => transactionView(await api.getTransaction(id, { signal })) : null, [id])
  if (id && error) return <><Link className="back-link" to="/transactions"><ArrowLeft size={16} />Transactions</Link><ErrorNotice title="This transaction could not be opened." error={error} onRetry={reload} /></>
  if (id && !original) return <Loading>Loading transaction...</Loading>
  return <TransactionEditor key={id ?? 'new'} original={original} />
}

function TransactionEditor({ original }) {
  const { api } = useLive()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const draft = location.state?.draft
  const [form, setForm] = useState(() => original ? transactionFormValues(original) : draft ? mergeDraft(blankForm(params), draft) : blankForm(params))
  const [errors, setErrors] = useState({})
  const [review, setReview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [idempotencyKey, setIdempotencyKey] = useState(null)
  const kind = form.type === 'sale' ? 'customer' : 'supplier'
  const { data: contacts } = useResource(async (signal) => api.listContacts({ kind }, { signal }), [kind])
  const editing = Boolean(original)
  const alreadyPaid = editing ? original.paid : 0

  const update = (key) => (event) => {
    const value = event.target.value
    setForm((previous) => ({ ...previous, [key]: value, ...(key === 'party' ? { contactId: '' } : {}) }))
    setErrors((previous) => ({ ...previous, [key]: undefined }))
  }

  function validate() {
    const values = editing ? { ...form, paid: String(alreadyPaid / 100) } : form
    const next = validateTransaction(values)
    if (editing && next.paid) { delete next.paid; next.amount = `The amount cannot be less than the ${money(alreadyPaid)} already paid.` }
    if (!editing && form.date > today()) next.date = 'The date cannot be in the future.'
    if (form.dueDate && form.dueDate < form.date) next.dueDate = 'The due date cannot be before the transaction date.'
    if (!editing && toMinor(form.paid) > 0 && !form.method) next.method = 'Choose how the money was paid.'
    return next
  }

  function submit(event) {
    event.preventDefault()
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length) return
    if (editing && !Object.keys(transactionUpdateBody(original, form)).length) { setErrors({ description: 'Nothing has changed.' }); return }
    setSaveError(null)
    setIdempotencyKey(newIdempotencyKey()) // one key per reviewed save; retries reuse it
    setReview(true)
  }

  async function confirm() {
    setSaving(true); setSaveError(null)
    try {
      const saved = editing ? await api.updateTransaction(original.id, transactionUpdateBody(original, form)) : await api.createTransaction(transactionCreateBody(form), idempotencyKey)
      navigate(`/transactions/${saved.id}`, { replace: true, state: { notice: editing ? 'Changes saved.' : 'Transaction saved.' } })
    } catch (err) {
      setSaveError(err)
      if (err.fieldErrors && Object.keys(err.fieldErrors).length) {
        const mapped = {}
        for (const [field, names] of Object.entries(FIELD_MAP)) { const message = fieldError(err, ...names); if (message) mapped[field] = message }
        if (Object.keys(mapped).length) { setErrors(mapped); setReview(false) }
      }
    } finally { setSaving(false) }
  }

  const amount = toMinor(form.amount) ?? 0
  const paid = editing ? alreadyPaid : toMinor(form.paid) ?? 0
  const categories = CATEGORIES.some((c) => c.toLowerCase() === form.category.toLowerCase()) || !form.category ? CATEGORIES : [...CATEGORIES, categoryLabel(form.category)]
  const categoryValue = categories.find((c) => c.toLowerCase() === form.category.toLowerCase()) ?? ''
  const partyLabel = form.type === 'sale' ? 'Customer' : 'Supplier / payee'

  return <>
    <Link className="back-link" to={editing ? `/transactions/${original.id}` : '/transactions'}><ArrowLeft size={16} />{editing ? 'Transaction details' : 'Transactions'}</Link>
    <PageHeader title={review ? 'Review transaction' : editing ? 'Edit transaction' : 'Add transaction'} />
    <p className="subtitle">{review ? 'Check the details. Nothing is saved until you confirm.' : `${typeLabel(form.type)} · PKR · Asia/Karachi dates`}</p>
    {draft && !review && <div className="info-message"><p><strong>Draft from {draft.source === 'receipt' ? 'a receipt' : draft.source === 'voice' ? 'voice entry' : 'AI entry'}.</strong> It has not been saved. Check every field{draft.source === 'receipt' ? ', especially how much was actually paid (a receipt is not proof of payment)' : ''}.</p>
      {[...(draft.warnings ?? []), ...(draft.assumptions ?? [])].map((text) => <p key={text}>• {text}</p>)}</div>}
    {review ? <section className="review-sheet">
      <div className="review-total">{money(amount)}</div>
      <dl>{[
        ['Type', typeLabel(form.type)], ['Description', form.description.trim()], [partyLabel, form.party.trim() || 'Not specified'], ['Date', form.date], ['Category', categoryLabel(form.category)],
        ...(editing ? [['Already paid', money(alreadyPaid)]] : [['Paid now', money(paid)], ...(paid > 0 ? [['Payment method', methodLabel(form.method)]] : [])]),
        ['Will remain due', money(Math.max(0, amount - paid))], ...(form.dueDate && amount > paid ? [['Due date', form.dueDate]] : []), ...(form.notes.trim() ? [['Notes', form.notes.trim()]] : []),
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="demo-note">The server checks these details and calculates the saved balance.</p>
      <ErrorNotice error={saveError} title="Not saved." />
      {saveError?.code === 'timeout' || saveError?.code === 'network_error' ? <p className="warning-message">If the connection dropped after sending, confirming again is safe: the same save will not be recorded twice.</p> : null}
      <div className="dialog-actions"><button type="button" className="button" disabled={saving} onClick={() => setReview(false)}>Edit details</button><button type="button" className="button primary" disabled={saving} onClick={confirm}><Check size={18} />{saving ? 'Saving...' : editing ? 'Save changes' : 'Confirm and save'}</button></div>
    </section> : <form className="transaction-form" onSubmit={submit} noValidate>
      {editing ? <p className="demo-note">Type: {typeLabel(form.type)}. The type cannot change; void this record and add a new one instead. Payments are managed on the transaction page.</p>
        : <fieldset className="type-selector"><legend>Transaction type</legend>{TRANSACTION_TYPES.map(([type, label]) => <label key={type} className={form.type === type ? 'selected' : ''}><input type="radio" name="type" value={type} checked={form.type === type} onChange={update('type')} />{label}</label>)}</fieldset>}
      <div className="form-grid">
        <FormField label="Amount (PKR)" inputMode="decimal" value={form.amount} onChange={update('amount')} error={errors.amount} required />
        {!editing && <FormField label="Amount paid now (PKR)" inputMode="decimal" value={form.paid} onChange={update('paid')} error={errors.paid} required hint="Use 0 if nothing was paid; less than the total for a partial payment." />}
        <FormField label="Description" value={form.description} maxLength={500} onChange={update('description')} error={errors.description} required />
        <FormField label={partyLabel} value={form.party} maxLength={120} list="contact-options" onChange={update('party')} error={errors.party} hint="Required if any amount stays unpaid. A new name creates a new contact." />
        <datalist id="contact-options">{(contacts ?? []).map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <FormField label="Date" type="date" value={form.date} max={today()} onChange={update('date')} error={errors.date} required />
        <div className="form-field">
          <label htmlFor="transaction-category">Category</label>
          <select id="transaction-category" value={categoryValue} onChange={update('category')} aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? 'category-error' : undefined} required>
            <option value="">Choose category</option>
            {categories.map((category) => <option key={category}>{category}</option>)}
          </select>
          {errors.category && <span role="alert" id="category-error">{errors.category}</span>}
        </div>
        {!editing && paid > 0 && <div className="form-field">
          <label htmlFor="transaction-method">Payment method</label>
          <select id="transaction-method" value={form.method} onChange={update('method')} aria-invalid={Boolean(errors.method)}>{PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          {errors.method && <span role="alert">{errors.method}</span>}
        </div>}
        {!editing && paid > 0 && form.method !== 'cash' && <FormField label="Payment reference (optional)" value={form.reference} maxLength={100} onChange={update('reference')} error={errors.reference} />}
        {amount > paid && <FormField label="Due date (optional)" type="date" value={form.dueDate} min={form.date} onChange={update('dueDate')} error={errors.dueDate} />}
        <label className="form-field">Notes (optional)<textarea rows={2} maxLength={2000} value={form.notes} onChange={update('notes')} /></label>
      </div>
      <p className="demo-note">Repaying an old balance? Record it from Khata or the original transaction, not as a new sale or expense.</p>
      <ErrorNotice error={saveError && !review ? saveError : null} />
      <div className="dialog-actions"><Link className="button" to={editing ? `/transactions/${original.id}` : '/transactions'}>Cancel</Link><button className="button primary" type="submit">Review transaction</button></div>
    </form>}
  </>
}
