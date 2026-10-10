import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ScanLine, ArrowRight, PenLine } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import ImageUpload from '../../components/ui/ImageUpload'
import { money } from '../../features/transactions/model'
import { categoryLabel, methodLabel, typeLabel } from '../../services/adapters'
import { parseOptionalMoney } from '../../services/money'
import { useLive } from '../context.js'
import { ErrorNotice } from '../ui'
import { useUpload } from '../components/useUpload'
import UploadProgress from '../components/UploadProgress'

const KINDS = { receipt: 'Receipt (sale completed)', invoice: 'Invoice (amount requested)', bill: 'Bill (amount requested)', quotation: 'Quotation (price offer only)', unknown: 'Unclear document' }
const show = (minor) => (minor === null ? 'Not readable' : money(minor))

export default function Receipts() {
  const { api } = useLive()
  const navigate = useNavigate()
  const [file, setFile] = useState(null)
  const upload = useUpload((selected, options) => api.analyzeReceipt(selected, options))
  const r = upload.result

  function review() {
    navigate('/transactions/new', { state: { draft: { ...r.draft, source: 'receipt', warnings: [r.note, ...r.warnings] } } })
  }

  return <><PageHeader title="Receipt analyzer" /><p className="subtitle">Read a receipt or bill into a draft. You review it and decide how much was actually paid.</p>
    <div className="workflow-columns"><section>
      <ImageUpload label="Choose receipt image" onChange={(next) => { setFile(next); upload.reset() }} />
      <button type="button" className="button ai space-top" disabled={!file || upload.busy} onClick={() => upload.run(file)}><ScanLine size={18} />Analyze receipt</button>
      <UploadProgress phase={upload.phase} progress={upload.progress} onCancel={upload.cancel} />
      <ErrorNotice error={upload.error} title="The receipt could not be read." onRetry={file ? () => upload.run(file) : undefined} />
      {upload.error && <p className="info-message">Nothing was saved. You can <Link to="/transactions/new?type=expense">enter the details manually</Link>.</p>}
      <p className="demo-note">The image is sent to the server for reading and is not stored. A receipt is not proof of payment.</p>
    </section><section className="entry-workspace">
      <h2>Extracted details</h2>
      {!r ? <p className="subtitle">No fields have been extracted yet.</p> : <>
        <span className="badge indigo">Draft · not saved</span>
        <dl className="space-top">{[
          ['Document', KINDS[r.document_kind] ?? KINDS.unknown], ['Merchant', r.merchant_name ?? 'Not readable'], ['Date', r.receipt_date ?? 'Not readable'],
          ['Total', show(parseOptionalMoney(r.total_amount))], ['Tax', show(parseOptionalMoney(r.tax_amount))], ['Payment shown', r.payment_method_shown ? methodLabel(r.payment_method_shown) : 'Not shown'],
          ['Marked as paid', r.paid_marking_visible === true ? 'Yes, the document says paid' : r.paid_marking_visible === false ? 'No' : 'Unclear'],
          ['Draft type', `${typeLabel(r.draft.type)} · ${categoryLabel(r.draft.category)}`],
        ].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {r.line_items.length > 0 && <><h3 className="small-heading">Items</h3><div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Price</th><th scope="col">Total</th></tr></thead><tbody>{r.line_items.map((item, index) => <tr key={index}><th scope="row">{item.name ?? '—'}</th><td>{item.quantity ?? '—'}</td><td>{show(parseOptionalMoney(item.unit_price))}</td><td>{show(parseOptionalMoney(item.line_total))}</td></tr>)}</tbody></table></div></>}
        {r.warnings.map((w) => <p key={w} className="warning-message">{w}</p>)}
        {r.unreadable_fields.length > 0 && !r.warnings.some((w) => w.includes('unreadable')) && <p className="warning-message">Unreadable: {r.unreadable_fields.join(', ')}</p>}
        <p className="demo-note">{r.note.replace(' with POST /api/v1/transactions', '')}</p>
        <div className="dialog-actions"><Link className="button" to="/transactions/new?type=expense"><PenLine size={16} />Enter manually</Link><button type="button" className="button primary" onClick={review}>Review as transaction <ArrowRight size={16} /></button></div>
      </>}
    </section></div></>
}
