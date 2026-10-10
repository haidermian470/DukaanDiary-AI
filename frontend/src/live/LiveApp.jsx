import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import AppLayout from '../components/layout/AppLayout'
import PendingScreen from '../features/PendingScreen'
import LoginScreen from './LoginScreen'
import { useLive } from './context.js'
import { ErrorNotice, Loading } from './ui'
import WorkspaceBar from './WorkspaceBar'

const screens = {
  Dashboard: lazy(() => import('./screens/Dashboard')),
  Transactions: lazy(() => import('./screens/Transactions')),
  TransactionForm: lazy(() => import('./screens/TransactionForm')),
  TransactionDetail: lazy(() => import('./screens/TransactionDetail')),
  Credit: lazy(() => import('./screens/Credit')),
  Reports: lazy(() => import('./screens/Reports')),
  Insights: lazy(() => import('./screens/Insights')),
  DraftEntry: lazy(() => import('./screens/DraftEntry')),
  Assistant: lazy(() => import('./screens/Assistant')),
  Receipts: lazy(() => import('./screens/Receipts')),
  PaymentChecker: lazy(() => import('./screens/PaymentChecker')),
  DummyBank: lazy(() => import('./screens/DummyBank')),
  Settings: lazy(() => import('./screens/Settings')),
}

function page(Screen, props = {}, key = undefined) {
  return <Suspense fallback={<Loading>Loading page...</Loading>}><Screen key={key} {...props} /></Suspense>
}

function FullPage({ children }) {
  return <main id="main" tabIndex={-1} className="auth-page"><section className="auth-card">{children}</section></main>
}

export default function LiveApp() {
  const { session, me, meError, reloadMe, signOut, workspace, workspaceId, user } = useLive()
  if (session === undefined) return <FullPage><Loading>Restoring your session...</Loading></FullPage>
  if (!session) return <LoginScreen />
  if (meError) return <FullPage><h1>Could not open your shop</h1><ErrorNotice error={meError} onRetry={reloadMe} /><button type="button" className="button" onClick={signOut}><LogOut size={17} />Sign out</button></FullPage>
  if (!me || !workspace) return <FullPage><Loading>Opening your shop...</Loading></FullPage>

  const profile = { name: user?.email ?? '', store: workspace.name }
  const S = screens
  // Keying the routes by workspace reloads every screen's data when the shop changes.
  return <HashRouter><Routes key={workspaceId}><Route element={<AppLayout profile={profile} mode="live" notice={<WorkspaceBar />} />}>
    <Route index element={page(S.Dashboard)} />
    <Route path="transactions" element={page(S.Transactions)} />
    <Route path="transactions/new" element={page(S.TransactionForm)} />
    <Route path="transactions/:id" element={page(S.TransactionDetail)} />
    <Route path="transactions/:id/edit" element={page(S.TransactionForm)} />
    <Route path="credit" element={page(S.Credit)} />
    <Route path="dummy-bank" element={page(S.DummyBank)} />
    <Route path="ai-entry" element={page(S.DraftEntry, {}, 'typed')} />
    <Route path="voice" element={page(S.DraftEntry, { voice: true }, 'voice')} />
    <Route path="receipts" element={page(S.Receipts)} />
    <Route path="payment-check" element={page(S.PaymentChecker)} />
    <Route path="assistant" element={page(S.Assistant)} />
    <Route path="insights" element={page(S.Insights)} />
    <Route path="reports" element={page(S.Reports)} />
    <Route path="settings" element={page(S.Settings)} />
    <Route path="*" element={<PendingScreen title="Page not found" />} />
  </Route></Routes></HashRouter>
}
