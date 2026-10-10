import { lazy, Suspense } from 'react'
import { readConfig } from './config'
import ConfigProblem from './live/ConfigProblem'
import './App.css'

// Each mode is loaded separately: the demo bundle never includes the Supabase client,
// and live mode never includes the browser-only sample data.
const DemoApp = lazy(() => import('./DemoApp'))
const LiveRoot = lazy(() => import('./live/LiveRoot'))

const config = readConfig()

export default function App() {
  const fallback = <p role="status" className="boot-status">Loading DukaanDiary...</p>
  if (config.mode === 'demo') return <Suspense fallback={fallback}><DemoApp /></Suspense>
  if (config.mode === 'live') return <Suspense fallback={fallback}><LiveRoot config={config} /></Suspense>
  return <ConfigProblem problems={config.problems} />
}
