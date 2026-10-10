import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import FormField from '../../components/ui/FormField'
import PageHeader from '../../components/ui/PageHeader'
import Feedback from '../../components/ui/Feedback'
import { today, toMinor, money, validateTransaction, typeLabels } from './model'

export default function TransactionForm({ records, save, initialDraft }) {
  const { id } = useParams()
  const [params] = useSearchParams()
  const original = records.find((row) => row.id === id)
  const navigate = useNavigate()
  const [form, setForm] = useState(() => original ? { ...original, amount: String(original.amount / 100), paid: String(original.paid / 100) } : { type: ['sale', 'purchase', 'expense'].includes(params.get('type')) ? params.get('type') : 'sale', description: '', party: '', amount: '', paid: '0', date: today(), category: '', method: 'Cash', source: 'manual', ...initialDraft })
  const [errors, setErrors] = useState({})
  const [review, setReview] = useState(false)
  const linked = original && records.some((row) => row.obligationId === original.id)
  if ((id && !original) || original?.type.startsWith('payment_')) return <Feedback title="Transaction unavailable"><Link to="/transactions">Back to transactions</Link></Feedback>
  const update = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value })
    setErrors((previous) => ({ ...previous, [key]: undefined }))
  }
  const submit = (e) => { e.preventDefault(); const next = validateTransaction(form); setErrors(next); if (!Object.keys(next).length) setReview(true) }
  return <>
    <Link className="back-link" to="/transactions"><ArrowLeft size={16} />Transactions</Link>
    <PageHeader title={review ? 'Review transaction' : id ? 'Edit transaction' : 'Add transaction'} />
    <p className="subtitle">{review ? 'Check the details before confirming this sample entry.' : `${form.source} entry · PKR · Asia/Karachi`}</p>
    {initialDraft && !review && <p className="demo-note">Draft only. Check all fields, including the category and amount paid. Nothing is saved until you confirm.</p>}
    {linked ? <Feedback title="This record has linked payments"><p>Editing is unavailable until the payment-adjustment policy is agreed. The existing payment history is preserved.</p><Link className="button" to="/transactions">Back to transactions</Link></Feedback> : review ? <section className="review-sheet"><div className="review-total">{money(toMinor(form.amount))}</div><dl>{[['Type', typeLabels[form.type]], ['Description', form.description], ['Party', form.party || 'Not specified'], ['Date', form.date], ['Category', form.category], ['Payment method', form.method], ['Paid now', money(toMinor(form.paid))], ['Outstanding', money(toMinor(form.amount) - toMinor(form.paid))]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="demo-note">Sample entry only. No financial record will be sent to a server.</p><div className="dialog-actions"><button className="button" onClick={() => setReview(false)}>Edit details</button><button className="button primary" onClick={() => { save({ ...form, id: id || crypto.randomUUID(), amount: toMinor(form.amount), paid: toMinor(form.paid) }); navigate('/transactions') }}><Check size={18} />Confirm sample entry</button></div></section> : <form className="transaction-form" onSubmit={submit} noValidate>
      <fieldset className="type-selector"><legend>Transaction type</legend>{['sale', 'purchase', 'expense'].map((type) => <label key={type} className={form.type === type ? 'selected' : ''}><input type="radio" name="type" value={type} checked={form.type === type} onChange={update('type')} />{typeLabels[type]}</label>)}</fieldset>
      <div className="form-grid">
        <FormField label="Amount (PKR)" inputMode="decimal" value={form.amount} onChange={update('amount')} error={errors.amount} required />
        <FormField label="Amount paid now (PKR)" inputMode="decimal" value={form.paid} onChange={update('paid')} error={errors.paid} required hint="Use 0 for unpaid; enter less than the total for partial payment." />
        <FormField label="Description" value={form.description} maxLength={200} onChange={update('description')} error={errors.description} required />
        <FormField label={form.type === 'sale' ? 'Customer' : 'Supplier / payee'} value={form.party} maxLength={100} onChange={update('party')} error={errors.party} />
        <FormField label="Date" type="date" value={form.date} onChange={update('date')} error={errors.date} required />
        <div className="form-field">
          <label htmlFor="transaction-category">Category</label>
          <select id="transaction-category" value={form.category} onChange={update('category')} aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? 'category-error' : undefined} required>
            <option value="">Choose category</option>
            {['Groceries', 'Inventory', 'Utilities', 'Transport', 'Rent', 'Salaries', 'Other'].map((category) => <option key={category}>{category}</option>)}
          </select>
          {errors.category && <span role="alert" id="category-error">{errors.category}</span>}
        </div>
        <label className="form-field">Payment method<select value={form.method} onChange={update('method')}>{['Cash', 'Bank transfer', 'Easypaisa', 'JazzCash'].map((method) => <option key={method}>{method}</option>)}</select></label>
      </div>
      <p className="demo-note">Repaying an existing balance? Use its linked payment workflow, not a new sale or expense.</p>
      <div className="dialog-actions"><Link className="button" to="/transactions">Cancel</Link><button className="button primary" type="submit">Review transaction</button></div>
    </form>}
  </>
}
