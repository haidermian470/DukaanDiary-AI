import { useState } from 'react'
import { Send, MessageCircle } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import { demoSummary } from '../../services/demo'
import { money, periodRange } from '../transactions/model'

const questions = ['What were my sales this week?', 'How much do customers owe?', 'Which category cost the most this month?']
export default function Assistant({ records }) {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  function ask(text) {
    const range = periodRange(text === questions[0] ? 'week' : 'month')
    const summary = demoSummary(records, range)
    let answer = 'The AI assistant is not connected yet. This question was not sent to an AI service. The suggested questions can show deterministic answers from the sample ledger.'
    if (text === questions[0]) answer = `Recorded sample sales: ${money(summary.sales)}. Period: ${range.start} to ${range.end} (Asia/Karachi). Repayments are excluded from sales.`
    if (text === questions[1]) answer = `Sample customer receivables: ${money(summary.receivables)} as of ${range.end}, after linked repayments. This is not a live account balance.`
    if (text === questions[2]) {
      const top = [...summary.categories].sort((a, b) => b.value - a.value)[0]
      answer = top ? `${top.name} is the highest-spending recorded sample category: ${money(Math.round(top.value * 100))}. Period: ${range.start} to ${range.end} (Asia/Karachi).` : `No operating expenses were recorded in the sample ledger from ${range.start} to ${range.end}.`
    }
    setMessages((previous) => [...previous, { id: crypto.randomUUID(), question: text, answer }]); setQuestion('')
  }
  return <><PageHeader title="AI Munshi" /><p className="subtitle">Financial Assistant · Sample ledger answers</p><div className="assistant-layout"><aside className="workflow-aside"><MessageCircle size={25} className="text-indigo" /><h2>Ask about your khata</h2><p>Suggested questions use the current sample records. Open-ended AI responses are not connected yet.</p><div className="suggested-questions">{questions.map((text) => <button className="button" key={text} onClick={() => ask(text)}>{text}</button>)}</div></aside><section className="chat-workspace"><div className="chat-history" role="log" aria-live="polite" aria-label="Conversation">{!messages.length && <p className="empty-inline">Choose a question or write your own.</p>}{messages.map((message) => <div key={message.id}><div className="chat-question"><small>You</small><p>{message.question}</p></div><div className="chat-answer"><small>Sample ledger assistant</small><p>{message.answer}</p></div></div>)}</div><form className="chat-composer" onSubmit={(e) => { e.preventDefault(); if (question.trim()) ask(question.trim()) }}><label className="form-field">Your question<textarea rows={3} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about sales, expenses, or balances..." /></label><button className="button ai" disabled={!question.trim()} type="submit"><Send size={17} />Send</button></form></section></div></>
}
