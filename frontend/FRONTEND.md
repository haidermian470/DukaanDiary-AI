# DukaanDiary frontend handoff

Branch: `frontend-dev`. Integration source of truth: the FastAPI code on the
`backend-dev` branch (`/api/v1`, schemas in `backend/app/schemas/`). That branch
is not merged yet; confirm with the team lead before treating it as final.

## Modes

The app picks a mode from public settings (`src/config.js`):

| Mode | When | What it does |
|---|---|---|
| live | `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` all set | Supabase sign-in, real backend data |
| demo | `VITE_APP_MODE=demo`, or nothing set during `npm run dev` | The original browser-only sample workspace (`src/DemoApp.jsx`), clearly labelled |
| setup needed | anything else (including a production build with no settings) | Lists what is missing. Never shows sample data |

A secret or service-role key in `VITE_SUPABASE_ANON_KEY` is refused. The base URL
must end in `/api/v1`. Live mode never falls back to sample data when a call fails.

## Live mode structure

```text
src/App.jsx                      Mode switch (demo and live load as separate chunks)
src/config.js                    Reads and validates public settings
src/services/api.js              HTTP client: token, X-Workspace-Id, Idempotency-Key,
                                 error envelope, one refresh on 401, uploads, downloads
src/services/endpoints.js        One function per backend route
src/services/money.js            Decimal string <-> integer paisa, no floating point
src/services/adapters.js         Backend shapes <-> view models and request bodies
src/live/LiveRoot.jsx            Creates the Supabase client (PKCE)
src/live/LiveProvider.jsx        Session, /me, workspace selection, API client
src/live/context.js              useLive() and useResource() (loading/error/reload)
src/live/LoginScreen.jsx         Sign in / create account
src/live/LiveApp.jsx             Routes for live screens
src/live/screens/*.jsx           Dashboard, Transactions, TransactionForm, TransactionDetail,
                                 Credit, Reports, Insights, DraftEntry (AI + voice),
                                 Assistant, Receipts, PaymentChecker, DummyBank, Settings
src/live/components/*            Transaction rows, trend chart, upload progress
```

Accounting and evidence rules the UI relies on (all enforced by the backend):
- Totals, balances and statuses come from the backend. The UI only formats them.
- Payments settle existing records (`/payments`, `/payments/settle-contact`);
  they never create a new sale or expense.
- Every reviewed save sends one `Idempotency-Key`; retrying the same review reuses it.
- AI and receipt results are drafts (`saved: false`) until the user confirms.
  AI confirm actions are limited to the three known save routes.
- Payment screenshots show the backend's outcome and per-field comparison.
  A response claiming proof of real payment is rejected. Dummy Bank screens show
  "DEMO — NO REAL BANK CONNECTION".

## Run

From `frontend/`, put live settings in `.env.local` (git-ignored; see `.env.example`):

```powershell
npm ci
npm run dev
npm run lint
npm run build
npm test                    # offline: Node unit tests + Vitest workflow tests
npm run test:integration    # needs a running backend, see below
```

Integration tests call a real backend with locally signed test tokens. Run the
backend with a throwaway database and the legacy JWT secret mode, then set:

```powershell
$env:INTEGRATION_API_URL = "http://127.0.0.1:8000/api/v1"
$env:INTEGRATION_JWT_SECRET = "<the backend's SUPABASE_JWT_SECRET for that test run>"
$env:INTEGRATION_ISSUER = "<the backend's SUPABASE_URL>/auth/v1"
npm run test:integration
```

Never point integration tests at real shop data.

## Deploy (Vercel)

- Build command `npm run build`, output `dist`, root directory `frontend`.
  Hash routes need no rewrite rules.
- Set `VITE_API_BASE_URL` (Render URL ending in `/api/v1`), `VITE_SUPABASE_URL`
  and `VITE_SUPABASE_ANON_KEY` in Vercel. Never the Gemini key, database password
  or a secret/service-role key.
- The backend's `FRONTEND_ORIGINS` must include the exact Vercel URL.
- In Supabase Auth, add the Vercel URL to the redirect URLs so email
  confirmation links return to the app.

## Verified

- Offline: lint, production build, 49 Node tests, 21 Vitest tests.
- Integration: 9 tests passed against the `backend-dev` code running locally
  on a throwaway PostgreSQL with signed test tokens (Gemini not configured).
- Headless Chrome against that backend: every live screen at 1440px and 390px
  with no errors or horizontal overflow; create sale, review, confirm, record
  payment end to end.

## Not verified yet

- A real Supabase project: sign-in, sign-up email confirmation, token refresh.
- Gemini-backed results: AI drafts, receipt extraction, screenshot comparison,
  AI-written assistant and insight wording (only the "AI unavailable" paths and
  template answers were exercised).
- Real microphone permissions and speech recognition on phones.
- Deployed Vercel + Render together, and screen-reader testing.

## Open questions for the team

- Confirm `backend-dev` as the agreed contract and merge plan.
- Confirm email/password as the sign-in method in Supabase.
- `/reports/summary` returns top-dues amounts inside untyped objects; the UI
  reads them as decimal strings. A typed schema would make this explicit.
