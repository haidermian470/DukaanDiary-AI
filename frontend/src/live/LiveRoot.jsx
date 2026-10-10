import { createClient } from '@supabase/supabase-js'
import LiveProvider from './LiveProvider'
import LiveApp from './LiveApp'

let supabase = null
function getSupabase(config) {
  // PKCE puts the email-confirmation code in the query string, which works with hash routes.
  supabase ??= createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  })
  return supabase
}

export default function LiveRoot({ config }) {
  return <LiveProvider config={config} supabase={getSupabase(config)}><LiveApp /></LiveProvider>
}
