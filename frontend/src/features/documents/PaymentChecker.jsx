import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import ImageUpload from '../../components/ui/ImageUpload'

const examples = {
  matched: { tone: 'green', title: 'Matched demo record', reason: 'Amount, reference, recipient, date, and completed status agree in this synthetic example.', action: 'Review the related obligation before importing the demo bank payment.' },
  pending: { tone: 'amber', title: 'Pending / delayed', reason: 'The synthetic bank record is pending. The screenshot claim does not establish completed settlement.', action: 'Wait for the demo record to show completed status.' },
  mismatch: { tone: 'red', title: 'Mismatch', reason: 'The screenshot claims PKR 1,500; the synthetic bank record shows PKR 1,000.', action: 'Check the amount and request corrected evidence.' },
  unverified: { tone: 'neutral', title: 'Unverified', reason: 'No authorized synthetic bank record is available for the claimed reference.', action: 'Do not mark the balance as settled from this image alone.' },
  suspicious: { tone: 'amber', title: 'Potentially suspicious', reason: 'This example reuses a reference attached to another claim. That is a review signal, not proof of fraud.', action: 'Review the existing reference and payment history.' },
}
export default function PaymentChecker() {
  const [file, setFile] = useState(null)
  const [message, setMessage] = useState('')
  const [example, setExample] = useState('')
  const result = examples[example]
  return <><PageHeader title="Payment evidence checker" /><p className="bank-warning"><ShieldCheck size={19} />DEMO — NO REAL BANK CONNECTION</p><div className="workflow-columns"><section><ImageUpload label="Choose payment screenshot" onChange={(next) => { setFile(next); setExample(''); setMessage('') }} /><button className="button ai space-top" disabled={!file} onClick={() => { setExample(''); setMessage('Screenshot extraction and backend comparison are not connected. This image is unverified and has not been uploaded.') }}>Analyze payment evidence</button>{message && <p role="status" className="info-message">{message}</p>}<p className="demo-note">Extracted text is evidence, not proof. A demo match never independently verifies a real payment.</p></section><section><h2>Comparison result</h2><p className="subtitle">No screenshot fields have been extracted.</p><label className="form-field">Synthetic result example<select value={example} onChange={(e) => { setExample(e.target.value); setMessage('') }}><option value="">Choose an example</option>{Object.entries(examples).map(([key, item]) => <option key={key} value={key}>{item.title}</option>)}</select></label>{result && <div className="space-top"><p className="demo-note">Fixed sample result only. This is unrelated to any selected image.</p><span className={`badge ${result.tone}`}>{result.title}</span><dl className="comparison-details"><div><dt>Claimed amount</dt><dd>{example === 'mismatch' ? 'PKR 1,500' : 'PKR 1,000'}</dd></div><div><dt>Demo bank amount</dt><dd>{example === 'unverified' ? 'No record' : 'PKR 1,000'}</dd></div><div><dt>Reference</dt><dd>{example === 'unverified' ? 'SYN-UNKNOWN' : 'SYN-ALI-01'}</dd></div><div><dt>Recipient</dt><dd>Bismillah Demo</dd></div></dl><h3 className="small-heading">Reason</h3><p>{result.reason}</p><h3 className="small-heading">Recommended action</h3><p>{result.action}</p></div>}</section></div></>
}
