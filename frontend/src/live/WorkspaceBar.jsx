import { useLive } from './context.js'

/** Top-of-page bar in live mode: which shop's real records are shown, with a shop switcher. */
export default function WorkspaceBar() {
  const { workspace, workspaces, selectWorkspace } = useLive()
  return <div className="live-notice">
    <span className="status-dot" aria-hidden="true" />
    <span>Live records · {workspace.name}</span>
    {workspaces.length > 1 && <label className="workspace-switch">
      <span className="visually-hidden">Switch shop</span>
      <select value={workspace.id} onChange={(e) => selectWorkspace(e.target.value)}>
        {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}{ws.role === 'owner' ? '' : ` (${ws.role})`}</option>)}
      </select>
    </label>}
  </div>
}
