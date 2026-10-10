import { RefreshCw } from 'lucide-react'

/** Loading indicator announced to screen readers. */
export function Loading({ children = 'Loading...' }) {
  return <p role="status" className="loading-line"><span className="spinner" aria-hidden="true" />{children}</p>
}

/** Shows a backend/network error honestly, with an optional retry. */
export function ErrorNotice({ error, onRetry, title }) {
  if (!error) return null
  const message = error.message || 'Something went wrong.'
  return <div role="alert" className="error-message error-block">
    {title && <strong>{title}</strong>}
    <p>{message}</p>
    {error.requestId && <small>Reference: {error.requestId}</small>}
    {onRetry && <button type="button" className="button compact" onClick={onRetry}><RefreshCw size={15} />Try again</button>}
  </div>
}

/** Small label shown on records created by the backend's fictional demo seed. */
export function DemoTag({ show }) {
  return show ? <span className="badge neutral">Demo record</span> : null
}
