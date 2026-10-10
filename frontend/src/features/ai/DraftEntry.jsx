import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mic, Square, Sparkles, ArrowRight } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import { today } from '../transactions/model'

export default function DraftEntry({ voice = false }) {
  const [text, setText] = useState('')
  const [language, setLanguage] = useState('ur-PK')
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState('')
  const recognitionRef = useRef(null)
  const navigate = useNavigate()
  const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  useEffect(() => () => {
    const recognition = recognitionRef.current
    if (recognition) { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.abort() }
  }, [])
  function start() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return setMessage('Speech recognition is unavailable in this browser. Type your transaction below.')
    const recognition = new SpeechRecognition()
    recognition.lang = language
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join(' ')
      setText((previous) => [previous, transcript].filter(Boolean).join(' '))
    }
    recognition.onerror = () => { setListening(false); setMessage('Microphone or speech recognition failed. You can still type and edit the transcript.') }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    try { recognition.start(); setListening(true); setMessage('') } catch { setMessage('Could not start the microphone. Please use typed input.'); setListening(false) }
  }
  return <><PageHeader title={voice ? 'Voice Khata' : 'AI transaction entry'} actions={<Link className="button" to={voice ? '/ai-entry' : '/voice'}>{voice ? 'Typed entry' : 'Voice entry'}</Link>} /><p className="subtitle">English, Urdu, or Roman Urdu. Every draft needs your review.</p>
    <div className="workflow-columns"><section className="entry-workspace">
      {voice && <><div className={`voice-control ${listening ? 'listening' : ''}`}><Mic size={30} /><h2>{listening ? 'Listening...' : 'Speak your transaction'}</h2><p>Browser speech recognition may use an online service.</p><button className="button ai" disabled={!supported} onClick={() => listening ? recognitionRef.current?.stop() : start()}>{listening ? <Square size={18} /> : <Mic size={18} />}{listening ? 'Stop microphone' : 'Start microphone'}</button>{!supported && <p role="status">Microphone transcription is unsupported here. Typed input is available below.</p>}</div><label className="form-field">Speech language<select disabled={listening} value={language} onChange={(e) => setLanguage(e.target.value)}><option value="ur-PK">Urdu (Pakistan)</option><option value="en-PK">English (Pakistan)</option></select></label></>}
      <label className="form-field space-top">{voice ? 'Editable transcript' : 'Describe the transaction'}<textarea rows={6} value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} placeholder="Aaj 2500 ki sale hui..." /></label>
      <div className="dialog-actions"><button className="button" onClick={() => { setText(''); setMessage('') }} disabled={listening}>Clear</button><button className="button ai" disabled={!text.trim() || listening} onClick={() => setMessage('AI transaction parsing is not connected yet. Your text has not been sent or saved. Use manual entry, or review the clearly labeled sample draft.')}><Sparkles size={17} />Create draft</button></div>
      {message && <p role="status" className="error-message">{message}</p>}
    </section><aside className="workflow-aside"><h2>Review before saving</h2><p>Check the amount, date, customer or supplier, and whether this is a new transaction or an old balance being repaid.</p><p className="demo-note">Sample draft: a PKR 2,500 cash sale. This example is unrelated to your typed text.</p><button className="button" onClick={() => navigate('/transactions/new', { state: { draft: { type: 'sale', amount: '2500', paid: '2500', description: 'Sample grocery sale', party: '', date: today(), category: 'Groceries', method: 'Cash', source: voice ? 'voice' : 'AI text' } } })}>Review sample draft <ArrowRight size={16} /></button><Link className="back-link" to="/transactions/new">Enter manually</Link></aside></div>
  </>
}
