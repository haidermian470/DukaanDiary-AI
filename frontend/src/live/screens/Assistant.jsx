import { useState } from 'react'
import { Send, MessageCircle } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import { money } from '../../features/transactions/model'
import { categoryLabel } from '../../services/adapters'
import { parseMoney } from '../../services/money'
import { useLive } from '../context.js'

const QUESTIONS = ['What were my sales this week?', 'How much do customers owe me?', 'Which expense category cost the most this month?', 'Is mahine kitna kharcha hua?', 'Why is my cash received lower than my sales?']
const DECIMAL = /^-?\d+\.\d{2}$/

// Figures are shown exactly as the backend calculated them. Two-decimal strings are money.
function formatFigure(value) {
  if (typeof value === 'string' && DECIMAL.test(value)) return money(parseMoney(value))
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length ? value.map(formatFigure).join(', ') : 'None'
  if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${categoryLabel(k.replaceAll('_', ' '))}: ${formatFigure(v)}`).join('; ')
  return String(value)
}

export default function Assistant() {
  const { api } = useLive()
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [busy, setBusy] = useState(false)

  async function ask(text) {
    const id = crypto.randomUUID()
    setMessages((previous) => [...previous, { id, question: text, pending: true }])
    setQuestion(''); setBusy(true)
    try {
      const answer = await api.askAssistant(text)
      setMessages((previous) => previous.map((m) => m.id === id ? { ...m, pending: false, answer } : m))
    } catch (error) {
      setMessages((previous) => previous.map((m) => m.id === id ? { ...m, pending: false, error } : m))
    } finally { setBusy(false) }
  }

  return <><PageHeader title="AI Munshi" /><p className="subtitle">Ask about your own saved records. Figures are calculated by the server; the AI only explains them.</p>
    <div className="assistant-layout"><aside className="workflow-aside"><MessageCircle size={25} className="text-indigo" /><h2>Ask about your khata</h2><p>English, Urdu or Roman Urdu. The assistant cannot change records and does not give tax or legal advice.</p><div className="suggested-questions">{QUESTIONS.map((text) => <button type="button" className="button" key={text} disabled={busy} onClick={() => ask(text)}>{text}</button>)}</div></aside>
      <section className="chat-workspace"><div className="chat-history" role="log" aria-live="polite" aria-label="Conversation">
        {!messages.length && <p className="empty-inline">Choose a question or write your own.</p>}
        {messages.map((m) => <div key={m.id}>
          <div className="chat-question"><small>You</small><p>{m.question}</p></div>
          <div className={`chat-answer ${m.error ? 'chat-error' : ''}`}>
            <small>AI Munshi</small>
            {m.pending ? <p role="status">Checking your records...</p>
              : m.error ? <p role="alert">{m.error.status === 429 ? 'Too many questions in a short time. Please wait a moment and ask again.' : m.error.message} No answer was generated.</p>
                : <>
                  <p>{m.answer.answer}</p>
                  {m.answer.period && <p className="chat-meta">Period: {m.answer.period.label} ({m.answer.period.date_from} to {m.answer.period.date_to}){m.answer.comparison_period ? ` · compared with ${m.answer.comparison_period.date_from} to ${m.answer.comparison_period.date_to}` : ''}</p>}
                  {Object.keys(m.answer.figures ?? {}).length > 0 && <details className="figures"><summary>Figures used</summary><dl>{Object.entries(m.answer.figures).map(([key, value]) => <div key={key}><dt>{categoryLabel(key.replaceAll('_', ' '))}</dt><dd>{formatFigure(value)}</dd></div>)}</dl></details>}
                  <p className="chat-meta">{m.answer.ai_generated ? 'Explained by AI from your figures.' : 'Standard answer (AI was not used).'}{m.answer.grounding_check === 'failed_fallback_used' ? ' The AI wording mentioned numbers not in your records, so a standard answer is shown.' : ''}</p>
                  {m.answer.notice && <p className="chat-meta">{m.answer.notice}</p>}
                </>}
          </div>
        </div>)}
      </div>
      <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); if (question.trim().length >= 2 && !busy) ask(question.trim()) }}><label className="form-field">Your question<textarea rows={3} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about sales, expenses, or balances..." /></label><button className="button ai" disabled={question.trim().length < 2 || busy} type="submit"><Send size={17} />{busy ? 'Asking...' : 'Send'}</button></form></section></div></>
}
