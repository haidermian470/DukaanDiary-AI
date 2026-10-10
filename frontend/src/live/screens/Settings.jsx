import { useState } from 'react'
import { Save, Server, LogOut, Database, Trash2 } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import FormField from '../../components/ui/FormField'
import Modal from '../../components/ui/Modal'
import { useLive } from '../context.js'
import { ErrorNotice} from '../ui'
import { fieldError } from '../errors'

const CHECK_LABELS = { ok: 'Working', configured: 'Configured', not_configured: 'Not configured', unreachable: 'Unreachable' }

export default function Settings() {
  const { api, config, user, workspace, workspaces, selectWorkspace, reloadMe, signOut } = useLive()
  const owner = workspace.role === 'owner'
  const [name, setName] = useState(workspace.name)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState({ busy: false, result: null, error: null })
  const [demo, setDemo] = useState({ busy: false, error: null, confirmReset: false })

  async function rename(e) {
    e.preventDefault()
    if (!name.trim()) return setSaveError({ message: 'Enter a shop name.', fieldErrors: { name: 'Enter a shop name.' } })
    setSaving(true); setSaveError(null); setNotice('')
    try { await api.renameWorkspace(name.trim()); reloadMe(); setNotice('Shop name saved.') } catch (err) { setSaveError(err) } finally { setSaving(false) }
  }
  async function check() {
    setStatus({ busy: true, result: null, error: null })
    try {
      const health = await api.health()
      let ready
      try { ready = await api.ready() } catch (err) { ready = err.status === 503 ? { status: 'not_ready', checks: null } : null }
      setStatus({ busy: false, result: { health, ready }, error: null })
    } catch (error) { setStatus({ busy: false, result: null, error }) }
  }
  async function seed() {
    setDemo({ busy: true, error: null, confirmReset: false }); setNotice('')
    try { await api.seedDemo(); setDemo({ busy: false, error: null, confirmReset: false }); setNotice('Fictional demo records were added. They are marked "Demo record".') } catch (error) { setDemo({ busy: false, error, confirmReset: false }) }
  }
  async function reset() {
    setDemo({ busy: true, error: null, confirmReset: true }); setNotice('')
    try { await api.resetDemo(); setDemo({ busy: false, error: null, confirmReset: false }); setNotice('Demo records and Dummy Bank data were removed. Your own records were not changed.') } catch (error) { setDemo({ busy: false, error, confirmReset: true }) }
  }

  return <><PageHeader title="Settings & profile" />
    {notice && <p role="status" className="success-message">{notice}</p>}
    <div className="workflow-columns"><section>
      <h2>Shop</h2>
      {owner ? <form onSubmit={rename} noValidate className="space-top"><FormField label="Shop name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} error={fieldError(saveError, 'name')} required /><button className="button primary space-top" type="submit" disabled={saving || name.trim() === workspace.name}><Save size={17} />{saving ? 'Saving...' : 'Save shop name'}</button></form>
        : <p className="subtitle">Only the shop owner can rename this shop.</p>}
      {saveError && !fieldError(saveError, 'name') && <ErrorNotice error={saveError} />}
      <dl className="space-top"><div><dt>Shop</dt><dd>{workspace.name}</dd></div><div><dt>Your role</dt><dd>{workspace.role}</dd></div><div><dt>Currency</dt><dd>{workspace.currency}</dd></div><div><dt>Timezone</dt><dd>{workspace.timezone}</dd></div></dl>
      {workspaces.length > 1 && <label className="form-field space-top">Switch shop<select value={workspace.id} onChange={(e) => selectWorkspace(e.target.value)}>{workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name} ({ws.role})</option>)}</select></label>}
      <h2 className="space-top">Demo records</h2>
      <p className="subtitle">Add clearly marked fictional records to practise or present. They can be removed at any time without touching your own records.</p>
      {owner ? <div className="dialog-actions start"><button type="button" className="button" disabled={demo.busy} onClick={seed}><Database size={17} />Add demo records</button><button type="button" className="button danger-outline" disabled={demo.busy} onClick={() => setDemo({ ...demo, confirmReset: true, error: null })}><Trash2 size={17} />Remove demo records</button></div> : <p>Only the shop owner can add or remove demo records.</p>}
      {!demo.confirmReset && <ErrorNotice error={demo.error} />}
    </section><section className="workflow-aside">
      <h2>Account</h2>
      <p>Signed in as <strong>{user.email}</strong></p>
      <button type="button" className="button" onClick={signOut}><LogOut size={17} />Sign out</button>
      <h2>Service status</h2>
      <p>Server: {config.apiBaseUrl}</p>
      <button type="button" className="button" onClick={check} disabled={status.busy}><Server size={17} />{status.busy ? 'Checking...' : 'Check connection'}</button>
      <ErrorNotice error={status.error} title="The server could not be reached." />
      {status.result && <dl className="status-list">
        <div><dt>Server</dt><dd>{status.result.health.status === 'healthy' ? 'Running' : status.result.health.status}</dd></div>
        {status.result.ready?.checks ? Object.entries(status.result.ready.checks).map(([key, value]) => <div key={key}><dt>{{ database: 'Database', auth: 'Sign-in checks', gemini: 'AI service' }[key] ?? key}</dt><dd>{CHECK_LABELS[value] ?? value}</dd></div>)
          : <div><dt>Readiness</dt><dd>{status.result.ready ? 'Not ready' : 'Unknown'}</dd></div>}
      </dl>}
      <p className="demo-note">Secrets such as the AI key and database password stay on the server and are never shown here.</p>
    </section></div>
    {demo.confirmReset && <Modal title="Remove demo records?" onClose={() => !demo.busy && setDemo({ ...demo, confirmReset: false })}>
      <p>This deletes every fictional demo record and all Dummy Bank demo data in {workspace.name}. Records you entered yourself are kept.</p>
      <ErrorNotice error={demo.error} />
      <div className="dialog-actions"><button type="button" className="button" disabled={demo.busy} onClick={() => setDemo({ ...demo, confirmReset: false })}>Cancel</button><button type="button" className="button destructive" disabled={demo.busy} onClick={reset}>{demo.busy ? 'Removing...' : 'Remove demo records'}</button></div>
    </Modal>}
  </>
}
