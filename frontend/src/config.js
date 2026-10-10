// Reads the public, browser-safe configuration from Vite environment variables.
//
// Modes:
//   live         - real Supabase sign-in and real backend data. Needs all three live settings.
//   demo         - the browser-only sample workspace. Never uses or mixes in server data.
//   misconfigured - live settings are incomplete or unsafe; the app explains what is wrong.
//
// Only public values belong here. Gemini keys, database passwords and Supabase secret or
// service-role keys must never be placed in VITE_ variables, because Vite publishes them.

function decodeJwtRole(key) {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json).role ?? null
  } catch {
    return null
  }
}

/** Returns a problem message if the key is a secret key that must stay on a server. */
export function secretKeyProblem(key) {
  if (!key) return null
  if (key.startsWith('sb_secret_')) return 'VITE_SUPABASE_ANON_KEY contains a Supabase secret key. Use the publishable (anon) key instead and rotate the exposed secret.'
  if (decodeJwtRole(key) === 'service_role') return 'VITE_SUPABASE_ANON_KEY contains a service-role key. Use the anon key instead and rotate the exposed key.'
  return null
}

export function readConfig(env = import.meta.env ?? {}) {
  const clean = (value) => String(value ?? '').trim()
  const apiBaseUrl = clean(env.VITE_API_BASE_URL).replace(/\/+$/, '')
  const supabaseUrl = clean(env.VITE_SUPABASE_URL).replace(/\/+$/, '')
  const supabaseAnonKey = clean(env.VITE_SUPABASE_ANON_KEY)
  const requested = clean(env.VITE_APP_MODE).toLowerCase()
  const problems = []

  if (requested && !['live', 'demo'].includes(requested)) problems.push('VITE_APP_MODE must be "live" or "demo".')
  if (requested === 'demo') return { mode: 'demo', apiBaseUrl, supabaseUrl, supabaseAnonKey, problems }

  if (!apiBaseUrl) problems.push('VITE_API_BASE_URL is not set.')
  else if (!/^https?:\/\/[^/]+.*\/api\/v1$/.test(apiBaseUrl)) problems.push('VITE_API_BASE_URL must be the backend address ending in /api/v1, for example http://localhost:8000/api/v1.')
  if (!supabaseUrl) problems.push('VITE_SUPABASE_URL is not set.')
  else if (!/^https?:\/\//.test(supabaseUrl)) problems.push('VITE_SUPABASE_URL must start with https://.')
  if (!supabaseAnonKey) problems.push('VITE_SUPABASE_ANON_KEY is not set.')
  const secret = secretKeyProblem(supabaseAnonKey)
  if (secret) problems.push(secret)

  const anyLiveSetting = apiBaseUrl || supabaseUrl || supabaseAnonKey
  if (!problems.length) return { mode: 'live', apiBaseUrl, supabaseUrl, supabaseAnonKey, problems }
  // With nothing configured during local development, open the clearly labelled sample workspace.
  if (!requested && !anyLiveSetting && env.DEV) return { mode: 'demo', apiBaseUrl, supabaseUrl, supabaseAnonKey, problems: [] }
  return { mode: 'misconfigured', apiBaseUrl, supabaseUrl, supabaseAnonKey: secret ? '' : supabaseAnonKey, problems }
}
