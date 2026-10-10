import { Settings2 } from 'lucide-react'

/** Shown when live settings are missing or unsafe. Never falls back to sample data. */
export default function ConfigProblem({ problems }) {
  return <main id="main" tabIndex={-1} className="auth-page">
    <section className="auth-card" aria-labelledby="config-title">
      <Settings2 size={32} className="text-indigo" />
      <h1 id="config-title">Setup needed</h1>
      <p className="subtitle">DukaanDiary cannot connect to its server with the current settings. No sample or cached data is shown instead.</p>
      <ul className="problem-list">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      <p className="demo-note">Set the values in <code>frontend/.env.local</code> (see <code>.env.example</code>) and restart the app. To preview the sample workspace instead, set <code>VITE_APP_MODE=demo</code>.</p>
    </section>
  </main>
}
