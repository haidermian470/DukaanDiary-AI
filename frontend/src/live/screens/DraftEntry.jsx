import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mic, Square, Sparkles, ArrowRight, Check, PenLine } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import FormField from '../../components/ui/FormField'
import { money, toMinor, today } from '../../features/transactions/model'
import { PAYMENT_METHODS, categoryLabel, methodLabel, typeLabel } from '../../services/adapters'
import { parseOptionalMoney, toDecimalString } from '../../services/money'
import { newIdempotencyKey } from '../../services/api'
import { useLive } from '../context.js'
import { ErrorNotice, Loading } from '../ui'

const AI_DOWN = ['ai_unavailable', 'ai_not_configured', 'ai_timeout', 'ai_rate_limited', 'service_not_configured']
const FIELD_NAMES = { amount: 'amount', total_amount: 'amount', transaction_type: 'type (sale, purchase or expense)', amount_paid: 'amount paid', contact_name: 'customer or supplier', party_name: 'customer or supplier', payment_method: 'payment method' }

function useSpeech(language, onText, onError) {
  const recognitionRef = useRef(null)
  const [listening, setListening] = useState(false)
  const supported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  useEffect(() => () => {
    const recognition = recognitionRef.current
    if (recognition) { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.abort() }
  }, [])
  function start() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return onError('Speech recognition is unavailable in this browser. Type your transaction below.')
    const recognition = new SpeechRecognition()
    recognition.lang = language
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event) => onText(Array.from(event.results).map((result) => result[0].transcript).join(' '))
    recognition.onerror = (event) => { setListening(false); onError(event.error === 'not-allowed' ? 'Microphone permission was denied. You can type instead.' : 'Speech recognition failed. You can still type and edit the transcript.') }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    try { recognition.start(); setListening(true); onError('') } catch { setListening(false); onError('Could not start the microphone. Please type instead.') }
  }
  return { supported, listening, start, stop: () => recognitionRef.current?.stop() }
}

export default function DraftEntry({ voice = false }) {
  const { api } = useLive()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [language, setLanguage] = useState('ur-PK')
  const [micMessage, setMicMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [original, setOriginal] = useState('')
  const [answer, setAnswer] = useState('')
  const speech = useSpeech(language, (spoken) => setText((previous) => [previous, spoken].filter(Boolean).join(' ')), setMicMessage)

  async function parse(body) {
    setBusy(true); setError(null)
    try {
      const response = await api.parseTransaction({ ...body, input_mode: voice ? 'voice' : 'typed' })
      if (response.saved !== false) throw Object.assign(new Error('The server returned an unexpected response.'), { code: 'invalid_response' })
      setResult(response)
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  function createDraft() {
    const value = text.trim()
    if (value.length < 2) return
    setOriginal(value); setAnswer(''); setResult(null)
    parse({ text: value })
  }
  function sendAnswer(event) {
    event.preventDefault()
    if (answer.trim().length < 2) return
    parse({ text: answer.trim(), previous_text: original })
    setAnswer('')
  }
  function reviewTransaction() {
    const d = result.transaction_draft
    navigate('/transactions/new', { state: { draft: { ...d, source: voice ? 'voice' : 'ai', warnings: result.warnings, assumptions: result.assumptions } } })
  }
  const reset = () => { setText(''); setResult(null); setError(null); setOriginal(''); setMicMessage('') }

  return <><PageHeader title={voice ? 'Voice Khata' : 'AI transaction entry'} actions={<Link className="button" to={voice ? '/ai-entry' : '/voice'}>{voice ? 'Typed entry' : 'Voice entry'}</Link>} />
    <p className="subtitle">English, Urdu, or Roman Urdu. The AI only prepares a draft; nothing is saved until you confirm.</p>
    <div className="workflow-columns"><section className="entry-workspace">
      {voice && <><div className={`voice-control ${speech.listening ? 'listening' : ''}`}><Mic size={30} /><h2>{speech.listening ? 'Listening...' : 'Speak your transaction'}</h2><p>Your browser turns speech into text, which may use an online service. You can edit the text before creating a draft.</p><button type="button" className="button ai" disabled={!speech.supported || busy} onClick={() => speech.listening ? speech.stop() : speech.start()}>{speech.listening ? <Square size={18} /> : <Mic size={18} />}{speech.listening ? 'Stop microphone' : 'Start microphone'}</button>{!speech.supported && <p role="status">Microphone transcription is unsupported here. Typed input is available below.</p>}</div><label className="form-field">Speech language<select disabled={speech.listening} value={language} onChange={(e) => setLanguage(e.target.value)}><option value="ur-PK">Urdu (Pakistan)</option><option value="en-PK">English (Pakistan)</option></select></label></>}
      {micMessage && <p role="status" className="info-message">{micMessage}</p>}
      <label className="form-field space-top">{voice ? 'Editable transcript' : 'Describe the transaction'}<textarea rows={5} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Ali ko 5000 ka saman becha, 3000 mil gaye, baqi kal" /></label>
      <div className="dialog-actions"><button type="button" className="button" onClick={reset} disabled={speech.listening || busy}>Clear</button><button type="button" className="button ai" disabled={text.trim().length < 2 || speech.listening || busy} onClick={createDraft}><Sparkles size={17} />{busy ? 'Reading...' : 'Create draft'}</button></div>
      {busy && <Loading>Preparing a draft...</Loading>}
      {error && <>
        <ErrorNotice error={error} title={AI_DOWN.includes(error.code) ? 'The AI helper is unavailable right now.' : 'The draft could not be prepared.'} onRetry={original ? () => parse({ text: original }) : undefined} />
        <p className="info-message">Your text is kept above and nothing was saved. You can <Link to="/transactions/new">enter the transaction manually</Link>.</p>
      </>}
      {result && <DraftResult result={result} voice={voice} onReview={reviewTransaction} onAnswer={sendAnswer} answer={answer} setAnswer={setAnswer} busy={busy} onSaved={reset} />}
    </section><aside className="workflow-aside"><h2>Review before saving</h2><p>Check the amount, date, customer or supplier, and whether this is a new sale or an old balance being repaid.</p><p>Repayments are recorded against existing dues. They are never counted as new sales.</p><Link className="back-link" to="/transactions/new"><PenLine size={16} />Enter manually instead</Link></aside></div>
  </>
}

function Notes({ result }) {
  return <>{result.warnings.map((w) => <p key={w} className="warning-message">{w}</p>)}{result.assumptions.length > 0 && <ul className="plain-list assumptions">{result.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}</>
}

function DraftResult({ result, onReview, onAnswer, answer, setAnswer, busy, onSaved }) {
  if (result.status === 'not_a_transaction') return <div role="status" className="info-message"><p><strong>This does not look like a transaction.</strong> Nothing was saved.</p>{result.clarification_question && <p>{result.clarification_question}</p>}</div>
  if (result.status === 'needs_clarification') return <section className="draft-card" aria-live="polite">
    <span className="badge amber">Needs more detail · not saved</span>
    <h2>{result.clarification_question}</h2>
    {result.missing_fields.length > 0 && <p className="text-muted">Missing: {result.missing_fields.map((f) => FIELD_NAMES[f] ?? f.replaceAll('_', ' ')).join(', ')}</p>}
    <Notes result={result} />
    <form onSubmit={onAnswer}><label className="form-field">Your answer<input value={answer} maxLength={1000} onChange={(e) => setAnswer(e.target.value)} placeholder="For example: 5000, cash" /></label><button type="submit" className="button ai space-top" disabled={busy || answer.trim().length < 2}>Send answer</button></form>
  </section>
  if (result.transaction_draft) {
    const d = result.transaction_draft
    const amount = parseOptionalMoney(d.amount)
    const paid = parseOptionalMoney(d.amount_paid)
    return <section className="draft-card" aria-live="polite">
      <span className="badge indigo">Draft · not saved</span>
      <h2>{typeLabel(d.type)} of {amount === null ? 'unknown amount' : money(amount)}</h2>
      <dl>{[['Description', d.description ?? '—'], [d.type === 'sale' ? 'Customer' : 'Supplier / payee', d.contact_name ? `${d.contact_name}${d.contact_match === 'new' ? ' (new contact)' : d.contact_match === 'existing' ? ' (existing)' : ''}` : 'Not named'], ['Paid now', paid === null ? '—' : money(paid)], ['Will remain due', parseOptionalMoney(d.amount_due) === null ? '—' : money(parseOptionalMoney(d.amount_due))], ['Method', paid ? methodLabel(d.payment_method) : '—'], ['Category', categoryLabel(d.category)], ['Date', d.transaction_date ?? today()], ...(d.due_date ? [['Due date', d.due_date]] : [])].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {d.similar_contacts?.length > 0 && <p className="warning-message">Similar existing names: {d.similar_contacts.map((c) => c.name).join(', ')}. Check you have the right person.</p>}
      <Notes result={result} />
      <button type="button" className="button primary space-top" onClick={onReview}>Review and edit draft <ArrowRight size={16} /></button>
    </section>
  }
  if (result.payment_draft) return <PaymentDraft result={result} onSaved={onSaved} />
  return <p className="info-message">The server did not return a usable draft. Nothing was saved.</p>
}

function PaymentDraft({ result, onSaved }) {
  const { api } = useLive()
  const d = result.payment_draft
  const advance = d.kind === 'advance'
  const [form, setForm] = useState({ amount: d.amount ? toDecimalString(parseOptionalMoney(d.amount)).replace(/\.00$/, '') : '', method: d.method ?? 'cash', date: d.payment_date ?? today() })
  const [key] = useState(newIdempotencyKey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [formError, setFormError] = useState('')
  const [done, setDone] = useState('')
  const before = parseOptionalMoney(d.outstanding_before)
  async function confirm() {
    const amount = toMinor(form.amount)
    if (!amount) return setFormError('Enter a positive amount.')
    if (!advance && before !== null && amount > before) return setFormError(`This is more than the ${money(before)} due.`)
    if (form.date > today()) return setFormError('The date cannot be in the future.')
    setFormError(''); setBusy(true); setError(null)
    try {
      await api.confirmDraft(result.confirm, { ...result.confirm.body, amount: toDecimalString(amount), method: form.method, payment_date: form.date }, key)
      setDone(`${money(amount)} ${advance ? 'advance' : 'payment'} saved for ${d.contact_name}. No new sale or expense was created.`)
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  if (done) return <div role="status" className="success-message"><p>{done}</p><button type="button" className="button compact" onClick={onSaved}>Enter another</button></div>
  return <section className="draft-card" aria-live="polite">
    <span className="badge indigo">Draft · not saved</span>
    <h2>{advance ? 'Advance from' : 'Payment against dues of'} {d.contact_name}</h2>
    {before !== null && <p>Currently {d.contact_kind === 'supplier' ? 'you owe' : 'owes you'} <strong>{money(before)}</strong>{parseOptionalMoney(d.outstanding_after) !== null ? `, which would become ${money(parseOptionalMoney(d.outstanding_after))}` : ''}.</p>}
    <Notes result={result} />
    <FormField label="Amount (PKR)" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
    <label className="form-field">Method<select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    <FormField label="Payment date" type="date" value={form.date} max={today()} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
    {formError && <p role="alert" className="error-message">{formError}</p>}
    <ErrorNotice error={error} title="Not saved." />
    <button type="button" className="button primary space-top" disabled={busy || !result.confirm} onClick={confirm}><Check size={17} />{busy ? 'Saving...' : 'Confirm and save payment'}</button>
  </section>
}
