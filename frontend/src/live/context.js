import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export const LiveContext = createContext(null)

export function useLive() {
  const value = useContext(LiveContext)
  if (!value) throw new Error('useLive must be used inside LiveProvider.')
  return value
}

/**
 * Loads data from the backend and tracks loading/error state.
 *
 * `load(signal)` returns a promise; pass `null` to skip loading (for example when a
 * filter is invalid). `deps` must be plain values (strings, numbers, booleans). When
 * they change, the previous request is cancelled and stale responses are ignored.
 * While a new request runs, the previous data stays visible with `loading: true`.
 */
export function useResource(load, deps) {
  const [version, setVersion] = useState(0)
  const key = `${JSON.stringify(deps)}#${version}`
  const [state, setState] = useState({ key: null, data: null, error: null })
  const enabled = Boolean(load)
  useEffect(() => {
    if (!load) return undefined
    const controller = new AbortController()
    Promise.resolve().then(() => load(controller.signal)).then(
      (data) => { if (!controller.signal.aborted) setState({ key, data, error: null }) },
      (error) => { if (!controller.signal.aborted && error?.code !== 'cancelled') setState({ key, data: null, error }) },
    )
    return () => controller.abort()
    // `load` is recreated every render; `key` captures the inputs that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  if (!enabled) return { data: null, error: null, loading: false, reload }
  const loading = state.key !== key
  return { data: state.data, error: loading ? null : state.error, loading, reload }
}
