# DukaanDiary frontend handoff

## Delivered increment

Work is on `frontend-dev`. The reference is `../design-reference/stitch/`: the
original HTML, mobile screenshot, and DESIGN.md extracted from the supplied ZIP.
Only a dashboard screen was supplied. Desktop navigation and remaining screens
are derived from the same typography, colors, spacing, and components.

The dashboard and transaction workflow run in an explicitly labeled sample
workspace. Changes are held in React memory and reset on reload. There is no
server persistence, authentication, or live financial integration in this increment.
The SRS takes priority over misleading reference labels such as "AI Verified".

Implemented:
- Responsive shell, desktop sidebar, mobile bottom navigation and expanded menu.
- Self-hosted Plus Jakarta Sans, Stitch color tokens, Lucide icons, Recharts.
- Dashboard date filters, sample summary, sales/expense chart, expense breakdown,
  cash received/paid, outstanding balances, recent transactions, quick actions.
- Transaction search/type/date filters, empty state, create/edit forms, validation,
  partial payment fields, explicit review/confirmation, delete/cancel dialog.
- Linked repayment fixtures do not become new sales. Editing/deleting obligations
  with linked payments is blocked until the backend adjustment policy is agreed.
- Customer/supplier/expense credit views, payment history, and reviewed settlements.
- Synthetic Dummy Bank history, status filters, eligible-obligation selection,
  confirmed imports, and duplicate protection within the sample session.
- Typed AI entry and voice transcript screens, browser speech recognition when
  supported, typed fallback, and clearly labeled sample drafts for review.
- Receipt/screenshot upload validation and local previews; receipt manual entry
  proceeds to draft review. Real extraction/comparison reports unavailable.
- Five synthetic payment-result examples, explicitly unrelated to uploaded images.
- Assistant chat with deterministic answers to suggested questions from the sample
  ledger. Open-ended AI questions report unavailable rather than inventing answers.
- Reports, sample CSV export, expense categories, equivalent-period comparisons,
  and explicit insufficient-history states for anomaly/comparison claims.
- Session-only profile settings and an optional actual `/health` status check.

## Files

```text
src/App.jsx                                Routes and sample workspace state
src/App.css                                Responsive app/component layout
src/index.css                              Global styles and local font imports
src/styles/tokens.css                      Stitch design tokens
src/components/layout/AppLayout.jsx        Navigation, brand, sample-data notice
src/components/ui/DateFilter.jsx           Period/custom date selection
src/components/ui/Modal.jsx                Native dialog confirmation
src/components/ui/{PageHeader,FormField,Feedback}.jsx  Shared existing primitives
src/features/dashboard/Dashboard.jsx       Sample overview
src/features/transactions/Transactions.jsx Search, filters, delete confirmation
src/features/transactions/TransactionList.jsx Ledger rows and status
src/features/transactions/TransactionForm.jsx Manual entry/edit/review
src/features/transactions/model.js         Input validation and date formatting
src/features/PendingScreen.jsx             Unavailable-service state
src/features/credit/Credit.jsx             Balances, history, payment confirmation
src/features/bank/DummyBank.jsx             Synthetic history and confirmed imports
src/features/ai/DraftEntry.jsx              Typed/voice input and sample draft review
src/features/ai/Assistant.jsx               Sample-grounded chat and AI unavailable state
src/features/documents/ReceiptAnalyzer.jsx  Upload and manually entered receipt draft
src/features/documents/PaymentChecker.jsx   Upload and separate synthetic result examples
src/features/analytics/Analytics.jsx        Reports, CSV export, expense insights
src/features/settings/Settings.jsx          Session profile and health-check control
src/components/ui/ImageUpload.jsx          File validation, preview, URL cleanup
src/services/demo.js                       Synthetic records and demo-only totals
src/services/api.js                        Existing transport for future integration
src/services/health.js                     Existing GET /health adapter
tests/api.test.mjs                         API transport tests
tests/transactions.test.mjs                Money/date/demo-accounting tests
tests/workflows.test.jsx                   React interaction tests
vitest.config.js                           jsdom workflow test configuration
index.html                                App metadata
package.json / package-lock.json           Dependencies and scripts
.env.example                               Public backend origin example
```

The root `AGENTS.md` now points to the supplied visual reference. No backend
files were changed. Reference scripts were not executed or copied into the app.

## Run and test

From `frontend/`:

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
npm run lint
npm run build
npm test
```

Vite can choose another port when one is occupied; use the printed URL. The
current preview uses port 5173. Hash routes work on static hosts without rewrite
rules. The dashboard/chart bundle loads separately from transaction screens.

## API integration and boundaries

No financial or AI endpoint is called. The inspected FastAPI backend implements
only `GET /` and `GET /health`. Settings calls the existing health adapter only
when the user chooses Check server status. Setting `VITE_API_BASE_URL` alone does
not enable live mode. Browser speech recognition may use its provider's online
transcription service after the user starts the microphone; it is not Gemini.

`VITE_API_BASE_URL` is the public backend origin (example: `http://localhost:8000`).
Never put Gemini or Supabase service-role secrets in browser environment variables.
Restart Vite after changing environment configuration. Backend CORS currently
allows localhost/127.0.0.1 on port 5173.

The sample adapter calculates non-authoritative fixture totals using integer
minor units. It must not be reused for live financial records. Live mode must
consume authorized backend summary results and replace sample state with service
operations after payload/authentication agreement. Failed live calls must never
silently fall back to demo data.

Needed contracts:
- Authentication and workspace context; token/cookie transport.
- Transaction schemas/enums, decimal serialization, partial-payment linkage,
  settlement operations, and edit/delete policy.
- Search/pagination/date filters, Asia/Karachi boundaries, field-error schemas.
- Summary, chart series, category breakdown, and historical balances.
- AI draft extraction/confirmation and ambiguity handling.
- Upload constraints, receipt/screenshot extraction, deterministic comparisons.
- Dummy Bank eligibility, duplicate-safe import, and confirmation.
- Credit/payment history, reports, profile/settings endpoints.

## Verification checklist

- Automated API transport and sample accounting/date tests: `npm test`.
- Automated React review-before-save, edit protection, search/delete confirmation,
  payment/import confirmation, voice fallback, draft source preservation, sample
  assistant answers, and extraction-unavailable/sample-result separation:
  `npm test`. jsdom dialog shim tests state only, not native focus behavior.
- Lint and production build: run commands above.
- Local preview HTTP availability: checked separately.
- Desktop/mobile visual match, chart rendering, screen-reader behavior, native
  dialog focus/escape, and physical touch layouts: need browser verification.
- Current automated result: 24 tests pass (15 transport/model, 9 React workflows).
- Live API/auth/workspace isolation, server persistence, Gemini, actual image
  extraction/matching, native microphone permissions/transcription, file decoding,
  CSV download in a real browser, and responsive layouts: not verified.

Browser tools were unavailable in the implementation session. Do not treat
jsdom or a successful build as visual QA. Review at 390px and 1440px widths before
approving the visual match to Stitch.

## Next increment

Agree the financial API payloads and authentication with Member 4, then replace
the sample adapter. Integrate AI parsing, receipt/screenshot extraction, backend
comparison, and assistant with Member 5's agreed schemas. Sign-in remains deferred
until the authentication method is agreed. Complete actual browser verification
for the new screens and microphone/upload/export interactions. Keep deterministic
payment evidence outcomes and user-confirmed saving throughout.
