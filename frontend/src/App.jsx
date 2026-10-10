import { lazy, Suspense, useRef, useState } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import Transactions from './features/transactions/Transactions'
import TransactionForm from './features/transactions/TransactionForm'
import PendingScreen from './features/PendingScreen'
import { makeDemoRecords, createDemoSettlement, createDemoBankImport } from './services/demo'
import Credit from './features/credit/Credit'
import DummyBank from './features/bank/DummyBank'
import DraftEntry from './features/ai/DraftEntry'
import Assistant from './features/ai/Assistant'
import ReceiptAnalyzer from './features/documents/ReceiptAnalyzer'
import PaymentChecker from './features/documents/PaymentChecker'
import Settings from './features/settings/Settings'
import './App.css'

const Dashboard = lazy(() => import('./features/dashboard/Dashboard'))
const Analytics = lazy(() => import('./features/analytics/Analytics'))

function FormRoute(props) {
  const location = useLocation()
  return <TransactionForm key={location.key} initialDraft={location.state?.draft} {...props} />
}
export default function App() {
  const [records, setRecords] = useState(makeDemoRecords)
  const recordsRef = useRef(records)
  const [profile, setProfile] = useState({ name: 'Ahmed', store: 'Bismillah Kirayana Store' })
  const [notice, setNotice] = useState('')
  function commit(next) { recordsRef.current = next; setRecords(next) }
  function save(row) {
    const previous = recordsRef.current
    commit(previous.some((item) => item.id === row.id) ? previous.map((item) => item.id === row.id ? row : item) : [row, ...previous])
    setNotice('Sample transaction saved in this tab. No server record was created.')
  }
  function remove(id) {
    const previous = recordsRef.current
    commit(previous.some((row) => row.obligationId === id) ? previous : previous.filter((row) => row.id !== id))
    setNotice('Sample transaction deleted from this tab.')
  }
  function settle(payment) { const next = createDemoSettlement(recordsRef.current, payment); commit([next, ...recordsRef.current]) }
  function importBank(bank, obligationId) { const next = createDemoBankImport(recordsRef.current, bank, obligationId); commit([next, ...recordsRef.current]) }
  return <HashRouter><Routes><Route element={<AppLayout profile={profile} />}>
    <Route index element={<Suspense fallback={<p role="status">Loading overview...</p>}><Dashboard records={records} profile={profile} /></Suspense>} />
    <Route path="transactions" element={<Transactions records={records} remove={remove} notice={notice} />} />
    <Route path="transactions/new" element={<FormRoute records={records} save={save} />} />
    <Route path="transactions/:id/edit" element={<FormRoute records={records} save={save} />} />
    <Route path="credit" element={<Credit records={records} settle={settle} />} />
    <Route path="dummy-bank" element={<DummyBank records={records} importBank={importBank} />} />
    <Route path="ai-entry" element={<DraftEntry key="typed" />} />
    <Route path="voice" element={<DraftEntry key="voice" voice />} />
    <Route path="receipts" element={<ReceiptAnalyzer />} />
    <Route path="payment-check" element={<PaymentChecker />} />
    <Route path="assistant" element={<Assistant records={records} />} />
    <Route path="insights" element={<Suspense fallback={<p role="status">Loading insights...</p>}><Analytics key="insights" records={records} insights /></Suspense>} />
    <Route path="reports" element={<Suspense fallback={<p role="status">Loading reports...</p>}><Analytics key="reports" records={records} /></Suspense>} />
    <Route path="settings" element={<Settings profile={profile} onSave={setProfile} />} />
    <Route path="*" element={<PendingScreen title="Page not found" />} />
  </Route></Routes></HashRouter>
}
