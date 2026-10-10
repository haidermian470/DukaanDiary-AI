import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, ArrowRight } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import ImageUpload from '../../components/ui/ImageUpload'
import { useLive, useResource } from '../context.js'
import { ErrorNotice, Loading } from '../ui'
import { useUpload } from '../components/useUpload'
import UploadProgress from '../components/UploadProgress'

const OUTCOMES = {
  matched_demo_record: { tone: 'green', title: 'Matches a demo bank record' },
  pending_or_delayed: { tone: 'amber', title: 'Pending or delayed' },
  mismatch: { tone: 'red', title: 'Details do not match' },
  unverified: { tone: 'neutral', title: 'Could not be verified' },
  potentially_suspicious: { tone: 'red', title: 'Potentially suspicious' },
}
const RESULT_LABELS = { match: 'Match', close: 'Close match', mismatch: 'Mismatch', not_available: 'Not available' }
const RESULT_TONES = { match: 'green', close: 'amber', mismatch: 'red', not_available: 'neutral' }
const FIELD_LABELS = { amount: 'Amount', reference: 'Reference', date: 'Date', datetime: 'Date and time', recipient: 'Recipient', recipient_name: 'Recipient', sender: 'Sender', status: 'Status' }

export default function PaymentChecker() {
  const { api } = useLive()
  const [file, setFile] = useState(null)
  const history = useResource(async (signal) => api.screenshotChecks(10, { signal }), [])
  const upload = useUpload(async (selected, options) => {
    const result = await api.analyzeScreenshot(selected, options)
    // A screenshot is never proof of a real payment; refuse a response that says otherwise.
    if (result.proves_real_payment !== false || !OUTCOMES[result.outcome]) throw Object.assign(new Error('The server returned an unexpected verification result, so it is not shown.'), { code: 'invalid_response' })
    history.reload()
    return result
  })
  const r = upload.result
  const outcome = r && OUTCOMES[r.outcome]
  return <><PageHeader title="Payment evidence checker" /><p className="bank-warning"><ShieldCheck size={19} />DEMO — NO REAL BANK CONNECTION</p>
    <p className="subtitle">Compare a payment screenshot with the synthetic Dummy Bank. A screenshot is evidence to compare, not proof of payment.</p>
    <div className="workflow-columns"><section>
      <ImageUpload label="Choose payment screenshot" onChange={(next) => { setFile(next); upload.reset() }} />
      <button type="button" className="button ai space-top" disabled={!file || upload.busy} onClick={() => upload.run(file)}>Check payment evidence</button>
      <UploadProgress phase={upload.phase} progress={upload.progress} onCancel={upload.cancel} />
      <ErrorNotice error={upload.error} title="The screenshot could not be checked." onRetry={file ? () => upload.run(file) : undefined} />
      <p className="demo-note">The server reads the image and applies fixed comparison rules. AI only reads the text; it does not decide the result. The image is not stored.</p>
    </section><section>
      <h2>Comparison result</h2>
      {!r ? <p className="subtitle">No screenshot has been checked yet.</p> : <div className="space-top" aria-live="polite">
        <span className={`badge ${outcome.tone} outcome-badge`}>{outcome.title}</span>
        <p className="outcome-label">{r.outcome_label} · {r.confidence} confidence</p>
        {r.comparisons.length > 0 && <div className="table-scroll"><table className="data-table"><caption className="visually-hidden">Screenshot compared with demo bank record</caption><thead><tr><th scope="col">Field</th><th scope="col">Screenshot</th><th scope="col">Demo bank</th><th scope="col">Result</th></tr></thead>
          <tbody>{r.comparisons.map((c) => <tr key={c.field}><th scope="row">{FIELD_LABELS[c.field] ?? c.field}</th><td>{c.screenshot_value ?? '—'}</td><td>{c.record_value ?? '—'}</td><td><span className={`badge ${RESULT_TONES[c.result]}`}>{RESULT_LABELS[c.result] ?? c.result}</span>{c.note && <small className="cell-note">{c.note}</small>}</td></tr>)}</tbody></table></div>}
        <h3 className="small-heading">Reason</h3><p>{r.explanation}</p>
        <h3 className="small-heading">Recommended action</h3><p>{r.recommended_action}</p>
        {r.matched_record_reference && <p className="info-message">Demo bank record: {r.matched_record_reference}{r.already_imported ? ' (already recorded in your books)' : ''}. {!r.already_imported && r.outcome === 'matched_demo_record' && <Link to="/dummy-bank">Record it from Dummy Bank <ArrowRight size={14} /></Link>}</p>}
        <p className="demo-note">{r.disclaimer} This result does not prove that real money moved.</p>
      </div>}
      <h3 className="small-heading">Recent checks</h3>
      <ErrorNotice error={history.error} onRetry={history.reload} />
      {history.data ? history.data.length ? <ul className="history-list wide">{history.data.map((h) => <li key={h.id}><span>{new Date(h.created_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' })}<small>{h.explanation}</small></span><span className={`badge ${OUTCOMES[h.outcome]?.tone ?? 'neutral'}`}>{OUTCOMES[h.outcome]?.title ?? h.outcome}</span></li>)}</ul> : <p className="empty-inline">No checks yet.</p> : history.loading && <Loading />}
    </section></div></>
}
