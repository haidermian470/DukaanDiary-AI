import { useCallback, useEffect, useMemo, useState } from 'react'
import { createApiClient } from '../services/api.js'
import { createEndpoints } from '../services/endpoints.js'
import { LiveContext } from './context.js'

const workspaceKey = (userId) => `dukaandiary.workspace.${userId}`
function readStoredWorkspace(userId) {
  try { return localStorage.getItem(workspaceKey(userId)) } catch { return null }
}
function storeWorkspace(userId, workspaceId) {
  try { localStorage.setItem(workspaceKey(userId), workspaceId) } catch { /* storage unavailable: selection lasts for this tab */ }
}

/** Holds the selected workspace id for request headers, outside React rendering. */
class WorkspaceHolder {
  id = null
  set(id) { this.id = id }
  get() { return this.id }
}

/**
 * Holds the Supabase session, the authenticated backend client, the current user and
 * their shops (workspaces). Screens read it with useLive().
 * `supabase` is the Supabase client, injected so tests can pass a fake.
 */
export default function LiveProvider({ config, supabase, fetchImpl, xhrFactory, children }) {
  const [session, setSession] = useState(undefined) // undefined = still restoring
  const [me, setMe] = useState(null)
  const [meError, setMeError] = useState(null)
  const [workspaceId, setWorkspaceId] = useState(null)
  const [authNotice, setAuthNotice] = useState('')
  const [holder] = useState(() => new WorkspaceHolder())

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session ?? null) }).catch(() => { if (active) setSession(null) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null)
      if (!next) { setMe(null); setWorkspaceId(null); holder.set(null) }
    })
    return () => { active = false; data?.subscription?.unsubscribe() }
  }, [supabase, holder])

  const api = useMemo(() => createEndpoints(createApiClient({
    baseUrl: config.apiBaseUrl,
    fetchImpl,
    xhrFactory,
    getAccessToken: async () => {
      const { data } = await supabase.auth.getSession()
      return data.session?.access_token ?? null
    },
    getWorkspaceId: () => holder.get(),
    refreshSession: async () => {
      const { data, error } = await supabase.auth.refreshSession()
      return !error && Boolean(data?.session)
    },
    onAuthError: (error) => {
      setAuthNotice(error.code === 'token_expired' ? 'Your session expired. Please sign in again.' : 'Your sign-in could not be verified. Please sign in again.')
      supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    },
  })), [config.apiBaseUrl, supabase, fetchImpl, xhrFactory, holder])

  const userId = session?.user?.id ?? null
  const [meVersion, setMeVersion] = useState(0)
  useEffect(() => {
    if (!userId) return undefined
    const controller = new AbortController()
    api.me({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      const ids = result.workspaces.map((ws) => ws.id)
      const stored = readStoredWorkspace(result.user.id)
      const chosen = ids.includes(stored) ? stored : result.current_workspace_id
      holder.set(chosen)
      setWorkspaceId(chosen)
      setMe(result)
      setMeError(null)
    }, (error) => {
      if (!controller.signal.aborted && error.code !== 'cancelled') setMeError(error)
    })
    return () => controller.abort()
  }, [userId, api, holder, meVersion])

  /** Re-read the user and shops (after a rename, or to retry a failed load). */
  const reloadMe = useCallback(() => { setMeError(null); setMeVersion((v) => v + 1) }, [])

  const selectWorkspace = useCallback((id) => {
    if (!me?.workspaces.some((ws) => ws.id === id)) return
    holder.set(id)
    storeWorkspace(me.user.id, id)
    setWorkspaceId(id)
  }, [me, holder])

  const signIn = useCallback(async (email, password) => {
    setAuthNotice('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message || 'Sign-in failed.')
  }, [supabase])

  const signUp = useCallback(async (email, password) => {
    setAuthNotice('')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw new Error(error.message || 'Account could not be created.')
    return { needsConfirmation: !data.session }
  }, [supabase])

  const signOut = useCallback(async () => {
    setAuthNotice('')
    await supabase.auth.signOut()
  }, [supabase])

  const workspace = me?.workspaces.find((ws) => ws.id === workspaceId) ?? null
  const value = useMemo(() => ({
    config, api, session, user: me?.user ?? (session?.user ? { id: session.user.id, email: session.user.email } : null),
    me, meError, reloadMe, workspace, workspaces: me?.workspaces ?? [], workspaceId, selectWorkspace,
    signIn, signUp, signOut, authNotice,
  }), [config, api, session, me, meError, reloadMe, workspace, workspaceId, selectWorkspace, signIn, signUp, signOut, authNotice])

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}
