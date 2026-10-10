import { useState } from 'react'
import { Save, Server } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import FormField from '../../components/ui/FormField'
import { getHealth } from '../../services/health'

export default function Settings({ profile, onSave }) {
  const [draft, setDraft] = useState(profile)
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState('')
  const [checking, setChecking] = useState(false)
  async function check() {
    setChecking(true); setStatus('')
    try { const result = await getHealth(); setStatus(`${result.application}: healthy. This does not confirm database access or authentication.`) } catch (error) { setStatus(error.message) } finally { setChecking(false) }
  }
  return <><PageHeader title="Settings & profile" /><div className="workflow-columns"><section><h2>Sample workspace profile</h2><p className="subtitle">Changes apply to this tab and reset on reload.</p><form onSubmit={(e) => { e.preventDefault(); if (!draft.name.trim() || !draft.store.trim()) { setNotice('Enter your name and shop name.'); return } onSave({ name: draft.name.trim(), store: draft.store.trim() }); setNotice('Sample profile updated in this tab.') }}><div className="form-grid"><FormField label="Your name" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /><FormField label="Shop name" value={draft.store} maxLength={80} onChange={(e) => setDraft({ ...draft, store: e.target.value })} required /></div><button className="button primary space-top" type="submit"><Save size={17} />Save sample profile</button>{notice && <p role="status" className="success-message">{notice}</p>}</form><dl className="space-top"><div><dt>Currency</dt><dd>PKR</dd></div><div><dt>Timezone</dt><dd>Asia/Karachi</dd></div><div><dt>Workspace</dt><dd>Sample only</dd></div></dl></section><section className="workflow-aside"><h2>Account access</h2><p>Sign-in and workspace membership are not connected. No credentials or real financial data are stored here.</p><h2>Service availability</h2><button className="button" onClick={check} disabled={checking}><Server size={17} />{checking ? 'Checking...' : 'Check server status'}</button>{status && <p role="status" className="demo-note">{status}</p>}<p>Checking server status does not switch this sample workspace to live data.</p></section></div></>
}
