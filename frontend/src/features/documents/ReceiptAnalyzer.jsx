import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import ImageUpload from '../../components/ui/ImageUpload'
import FormField from '../../components/ui/FormField'
import { toMinor, today } from '../transactions/model'

export default function ReceiptAnalyzer() {
  const [file, setFile] = useState(null)
  const [message, setMessage] = useState('')
  const [merchant, setMerchant] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [type, setType] = useState('expense')
  const navigate = useNavigate()
  function review(e) {
    e.preventDefault()
    if (!merchant.trim() || !toMinor(amount) || !date) return setMessage('Enter a merchant, a valid positive amount, and a date before review.')
    navigate('/transactions/new', { state: { draft: { type, amount, paid: '0', description: `Receipt from ${merchant}`, party: merchant, date, category: '', method: 'Cash', source: 'receipt' } } })
  }
  return <><PageHeader title="Receipt analyzer" /><p className="subtitle">Review receipt details before recording a purchase or expense.</p><div className="workflow-columns"><section><ImageUpload label="Choose receipt image" onChange={(next) => { setFile(next); setMessage('') }} /><button className="button ai space-top" disabled={!file} onClick={() => setMessage('Receipt extraction is not connected. The image stays in this browser. You can enter visible details manually below.')}><ScanLine size={18} />Analyze receipt</button><p className="demo-note">A receipt is not proof of payment. Payment starts at zero until you confirm what was paid.</p></section><section className="entry-workspace"><h2>Receipt details</h2><p className="subtitle">Manual review · No fields have been extracted by AI.</p><form onSubmit={review} noValidate><div className="form-grid"><FormField label="Merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} required /><FormField label="Total (PKR)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /><FormField label="Receipt date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /><label className="form-field">Record as<select value={type} onChange={(e) => setType(e.target.value)}><option value="expense">Operating expense</option><option value="purchase">Purchase</option></select></label></div>{message && <p role="status" className="error-message">{message}</p>}<button className="button primary space-top" type="submit">Review transaction draft</button></form></section></div></>
}
