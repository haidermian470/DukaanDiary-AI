# DukaanDiary AI — Backend

FastAPI backend for DukaanDiary AI: bookkeeping, dashboards and Gemini-powered assistance for small Pakistani shops.
Currency is **PKR** and the business timezone is **Asia/Karachi**.

- **Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Supabase Postgres, Supabase Auth, Google Gemini (`google-genai`).
- **API base path:** `/api/v1`, with interactive docs at `/docs`.
- **Tests:** 124 automated tests run against a real PostgreSQL. Gemini is mocked in tests.

---

## 1. Architecture

```
React (Vercel)  --Bearer token-->  FastAPI (Render)  --SQL-->  Supabase Postgres
      |                                 |
      +--- Supabase Auth (login) ---+   +--- Google Gemini (server-side key only)
```

| Rule | Why |
|---|---|
| The frontend never talks to the database or Gemini directly | Secrets stay on the server |
| Every request carries a Supabase access token, verified by the backend | The user id comes from the token, never from the request body |
| Every query is filtered by the user's workspace (shop) | One shop can never see another shop's data |
| AI proposes, the user confirms, the backend validates and saves | AI output is never saved automatically |
| All totals come from one accounting module (`ledger_service.py`) | The dashboard, ledgers, reports and assistant always agree |

### Folder structure

```
backend/
├── app/
│   ├── main.py                 # creates the FastAPI app, CORS, routers, error handlers
│   ├── core/                   # config, auth/authorization, errors, logging, rate limit
│   ├── database/               # SQLAlchemy models + session (connection)
│   ├── schemas/                # Pydantic request/response models (the API contract)
│   ├── routes/                 # thin HTTP handlers (one file per feature)
│   ├── services/               # business rules and calculations (tested directly)
│   │   ├── ledger_service.py         # THE accounting engine (balances, totals)
│   │   ├── transaction_service.py    # sales / purchases / expenses
│   │   ├── payment_service.py        # payments, settlements, advances
│   │   ├── dashboard_service.py      # dashboard, trends, reports, CSV
│   │   ├── gemini_service.py         # the only file that calls Gemini
│   │   ├── ai_transaction_service.py # sentence -> validated draft
│   │   ├── assistant_service.py      # AI Financial Assistant
│   │   ├── expense_insights_service.py
│   │   ├── receipt_service.py
│   │   ├── verification_service.py   # screenshot vs Dummy Bank matching rules
│   │   ├── dummy_bank_service.py     # synthetic bank + safe import
│   │   └── demo_service.py           # fictional demo data seed/reset
│   └── utils/                  # money, dates/periods, image checks, grounding check
├── migrations/001_initial_schema.sql   # database schema (source of truth)
├── scripts/                    # apply_migrations, check_gemini, make_demo_screenshots
├── demo_assets/                # SYNTHETIC payment screenshots for the demo
├── tests/                      # pytest suite
├── main.py                     # compatibility shim: `uvicorn main:app` still works
├── requirements.txt            # production dependencies (pinned)
├── requirements-dev.txt        # + pytest, local test Postgres, Pillow
└── .env.example                # every setting, with placeholders
```

---

## 2. Run it locally

**Prerequisites:** Python 3.12, plus Git. Node is only needed for the frontend.

Run these in PowerShell from the repository root:

```powershell
cd backend
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env      # then edit .env (see section 3)
python -m scripts.apply_migrations   # creates the tables in Supabase (see section 4)
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000/docs for Swagger and http://127.0.0.1:8000/api/v1/health/ready for readiness.

**Trying the API before login exists:** set `DEV_AUTH_BYPASS=true` in `.env`, with `APP_ENV=development`.
Requests without a token then act as a fixed local test user. The server refuses to start with this switched on when `APP_ENV=production`.

**Demo data:** call `POST /api/v1/demo/seed` in Swagger. It adds clearly marked fictional records, all flagged `is_demo: true` and labelled `[DEMO]`.

---

## 3. Environment variables

All variables are listed in [.env.example](.env.example). Never commit `.env`, because the repository `.gitignore` already excludes it.

| Variable | Required | Where to find it |
|---|---|---|
| `DATABASE_URL` | yes | Supabase → **Connect** → **Session pooler** URI, with your DB password filled in |
| `SUPABASE_URL` | yes | Supabase → Project Settings → API → Project URL |
| `SUPABASE_JWT_SECRET` | only legacy projects | Project Settings → API → JWT Settings. Leave empty if the project uses JWT signing keys |
| `GEMINI_API_KEY` | for AI features | Google AI Studio → Get API key |
| `GEMINI_MODEL` | yes (has default) | e.g. `gemini-2.5-flash`. Run `python -m scripts.check_gemini --list` to see the models your key can use |
| `FRONTEND_ORIGINS` | yes | Comma-separated frontend URLs, e.g. `http://localhost:5173,https://your-app.vercel.app` |
| `APP_ENV` | yes | `development` locally, `production` on Render |

**Check Gemini once the key is set:**

```powershell
python -m scripts.check_gemini          # one real test call, prints the structured result
python -m scripts.check_gemini --list   # models available to your key
```

If the default model is not available to your key, set `GEMINI_MODEL` to one from the list.

---

## 4. Supabase setup and migrations

1. In Supabase, open **Connect** and copy the **Session pooler** connection string into `DATABASE_URL`. Render only has IPv4, and Supabase's direct connection is IPv6, so use the pooler.
2. Apply the schema with **one** of these:
   - **Script:** `python -m scripts.apply_migrations`. It records applied files in `public.schema_migrations` and skips them next time. `--status` shows what is applied.
   - **SQL Editor:** paste [migrations/001_initial_schema.sql](migrations/001_initial_schema.sql) into the Supabase SQL Editor and click Run.
3. Verify the result:
   - Table Editor should show 10 tables, each marked "RLS enabled". There are 11 if you used the script, which adds `schema_migrations`.
   - `GET /api/v1/health/ready` should return `"database": "ok"`.

Pushing a migration file to GitHub does **not** apply it. Someone must run step 2.

**Future schema changes:** add `002_description.sql`, update `app/database/models.py` to match, then run the script again.

### Security model

- **Row Level Security is on, with no policies.** All privileges are revoked from Supabase's `anon` and `authenticated` roles. So the public Data API, which a browser could call with the publishable key, can read **nothing**. The test suite proves this.
- **Only the backend reaches the data.** It connects with the server-side connection string and checks workspace membership on every request.
- **No service-role key is used anywhere.**
- **Optional hardening:** create a dedicated Postgres role with only `SELECT/INSERT/UPDATE/DELETE` on these tables, and use it in `DATABASE_URL` instead of `postgres`.

---

## 5. Authentication flow for the frontend

1. The frontend logs in with `@supabase/supabase-js`, using `VITE_SUPABASE_URL` and the **publishable/anon** key. Both are safe in a browser, because the tables are locked as described above.
2. It gets the token with `const { data } = await supabase.auth.getSession(); data.session.access_token`.
3. It sends that token on every call: `Authorization: Bearer <access_token>`.
4. The backend verifies the signature, expiry, audience (`authenticated`) and issuer:
   - New projects are verified with the public keys from `SUPABASE_URL/auth/v1/.well-known/jwks.json`.
   - Legacy projects are verified with `SUPABASE_JWT_SECRET`.
5. On the first call, the backend creates the user's profile and a default shop called "My Shop". `GET /api/v1/me` returns it.
6. Optional: the `X-Workspace-Id` header selects another shop the user belongs to. Otherwise the first shop is used.

Missing, invalid or expired tokens return `401`. A token for one shop used with another shop's id returns `403`. Records from another shop return `404`.

---

## 6. Accounting model (read this before changing any calculation)

- **A transaction is an obligation.** It is a `sale`, `purchase` (stock) or `expense` with a total `amount`.
- **Money moves only through payments.** Each payment has a `direction` of `in` or `out` and a `status` of `completed`, `pending`, `failed` or `cancelled`.
- **Only completed payments count.**
  - `outstanding = amount − completed payments`.
  - `pending` payments are shown and reserve room, so a pending plus a completed payment cannot exceed the amount, but they are not counted as received.
  - Balances are **calculated, never stored**, so they cannot drift.

| Event | Sales | Received | Receivable |
|---|---|---|---|
| Sold 5,000, received 3,000 | +5,000 | +3,000 | +2,000 |
| Ahmed pays 2,000 of old dues (`/payments/settle-contact`) | — | +2,000 | −2,000 |
| Bought stock 10,000, paid 4,000 | purchases +10,000 | paid +4,000 | payable +6,000 |

**Explicit rules**

| Situation | Rule |
|---|---|
| Paying old dues | Creates payments only, never a new sale or expense. It is applied to the oldest due first |
| Overpayment | Refused. Money paid before any bill is an **advance** (`is_advance: true`). Advances count as cash and show on the contact as `advance_balance`, without auto-reducing dues |
| Credit portion with no name | Refused. Unpaid money must have a customer or supplier |
| Dates | Transaction and payment dates cannot be in the future. A payment cannot predate its record |
| Edit | The amount cannot drop below the payments recorded. The type cannot change |
| Delete (void) | Soft delete. The record and its payments leave every total but stay in the database for audit. Records linked to a Dummy Bank import cannot be voided |
| Refunds and reversals | A completed payment can be changed to `cancelled`, for example a bounced cheque. There is no separate refund type in this version. A mistaken record is voided |
| Pending payment | Can become `completed`, `failed` or `cancelled`. `failed` and `cancelled` are final |
| Duplicates | Send `Idempotency-Key: <uuid>` on every Save, and retries return the first result. Parallel payments are serialised by a row lock (tested) |
| Profit | **Not shown.** It needs cost-of-goods-sold. `net_cash_flow` is money in minus money out, not cash in hand |
| Periods | Sales, expenses and money in/out follow the selected period. Receivables and payables are always **as of today** |

Money is `NUMERIC(14,2)` in the database and `Decimal` in Python. JSON returns money as a **string** like `"5000.00"`, so use `Number()` only for display.

---

## 7. API reference

Full request and response schemas, with examples, are in Swagger at `/docs`. All paths start with `/api/v1`. All endpoints except health need a token.

### Core bookkeeping

| Method & path | Purpose |
|---|---|
| `GET /health`, `GET /health/ready` | Liveness / readiness (DB + config) |
| `GET /me`, `PATCH /workspaces/current` | Current user and shops; rename shop |
| `GET/POST /contacts`, `GET/PATCH /contacts/{id}` | Customers/suppliers with balances; one contact's ledger with running balance |
| `GET/POST /transactions` | List (filters: `type, category, settlement_status, contact_id, contact_name, date_from, date_to, search, overdue_only, page, page_size`) / create |
| `GET/PATCH/DELETE /transactions/{id}` | Detail with payments / edit / void |
| `GET/POST /payments`, `GET/PATCH /payments/{id}` | Payments against one record or advances; status changes |
| `POST /payments/settle-contact` | "Ahmed paid 2,000 against his dues" |
| `GET /dashboard/summary` | Cards, balances, received breakdown, recent transactions, definitions |
| `GET /dashboard/trends` | Chart points per `day`, `week` or `month` |
| `GET /dashboard/expense-breakdown` | Expenses by category with share % |
| `GET /reports/summary`, `GET /reports/transactions` | Report; add `format=csv` to download |

Period parameters are `period=today|yesterday|this_week|last_week|this_month|last_month|last_7_days|last_30_days|this_year|all_time`, or `date_from` and `date_to`.

### AI features

| Method & path | Purpose |
|---|---|
| `POST /ai/parse-transaction` | Sentence to **draft**. Never saves anything |
| `POST /ai/assistant` | Question to an answer grounded in calculated figures |
| `POST /ai/expense-insights` | Period comparison, top categories, unusual expenses and suggestions |
| `POST /ai/analyze-receipt` | Receipt image to **draft** (multipart field `file`) |
| `POST /ai/analyze-screenshot` | Payment screenshot compared with the Dummy Bank (**DEMO**) |
| `GET /ai/screenshot-checks` | Recent screenshot check results |

### Dummy Bank (synthetic) and demo data

| Method & path | Purpose |
|---|---|
| `GET /dummy-bank/accounts`, `GET /dummy-bank/transactions[/{id}]` | Synthetic data, seeded automatically per shop |
| `POST /dummy-bank/import/{id}` | Record a **completed** transfer: `settle_transaction`, `settle_contact` or `new_transaction` |
| `POST /dummy-bank/simulate/incoming` | Demo control: a transfer "arrives" |
| `POST /dummy-bank/simulate/transactions/{id}/status` | Demo control: pending to completed, failed or cancelled |
| `POST /demo/seed`, `DELETE /demo/data?confirm=true` | Add or remove fictional demo records (owner only) |

### Errors

Every error has the same shape:

```json
{"error": {"code": "business_rule_violation", "message": "This payment (Rs 3,000.00) is more than the amount still due (Rs 2,000.00).", "details": {"amount_due": "2000.00"}, "request_id": "..."}}
```

| Status | Meaning |
|---|---|
| 400 | Bad request (e.g. invalid period) |
| 401 | Not logged in / token invalid / `token_expired` |
| 403 | Not your workspace |
| 404 | Not found (including other shops' records) |
| 409 | Duplicate (import, contact name) or locked record |
| 413 / 415 | Image too large / not JPEG/PNG/WEBP |
| 422 | `validation_error` (fields) or `business_rule_violation` (accounting) |
| 429 | AI rate limit (see `Retry-After`) |
| 503 | `ai_unavailable`, `ai_rate_limited`, `ai_timeout`, `ai_not_configured`, `database_unavailable` |

### Example: AI entry to confirmed save

```http
POST /api/v1/ai/parse-transaction
{"text": "Sold goods worth Rs. 5,000 to Ali, received Rs. 3,000, rest tomorrow"}
```

```json
{
  "status": "ready_to_confirm",
  "intent": "new_transaction",
  "transaction_draft": {"type": "sale", "amount": "5000.00", "amount_paid": "3000.00", "amount_due": "2000.00",
                        "contact_name": "Ali", "contact_match": "new", "due_date": "2026-10-11", "...": "..."},
  "missing_fields": [],
  "warnings": [],
  "assumptions": [],
  "confirm": {"method": "POST", "path": "/api/v1/transactions", "body": {"type": "sale", "amount": "5000.00", "...": "..."}},
  "saved": false
}
```

1. The UI shows the draft in editable fields.
2. On **Confirm**, it sends `confirm.body`, including the user's edits, to `confirm.path` with an `Idempotency-Key` header.
3. If `status` is `needs_clarification`, the UI shows `clarification_question`. It then calls the endpoint again with the answer in `text` and the original sentence in `previous_text`.

---

## 8. How the AI is kept honest

- **Transaction parsing:**
  - Gemini returns JSON that matches a schema.
  - The backend re-validates every field and computes `amount_due` itself.
  - It refuses to guess a missing amount, payment status or name, and asks a question instead.
  - Defaults such as "today" or "cash" are listed in `assumptions`.
  - For "Ahmed paid 5000", the outstanding balance comes from the ledger. If the user's stated balance disagrees, the response warns.
- **Assistant:**
  1. Gemini only classifies the question into one of 14 fixed intents.
  2. The backend runs predefined queries for that shop and builds a facts object.
  3. Gemini writes the explanation from those facts only.
  4. The **grounding check** extracts every number in the answer. If one is not in the facts, the answer is discarded and a template answer built from the facts is shown, with `grounding_check: failed_fallback_used`.
  5. If Gemini is down, a keyword classifier and template answers keep it working, with `ai_generated: false` and a `notice`.
  6. There is no SQL generation and no write access.
- **Expense insights:** the numbers come from documented rules. "Unusual" means more than 2× the category's 90-day median, with 3 or more earlier records. Gemini only writes the wording, which also passes the grounding check.
- **Privacy:** phone numbers, ids and other shops' data are never sent to Gemini. Images are processed in memory and never stored.

---

## 9. Payment screenshot check — limitations (say this in the demo)

**DEMO — NO REAL BANK CONNECTION.**

- **What a match means:** the details read from the image match a **synthetic** Dummy Bank record. It does not prove that real money moved, and a screenshot is never treated as proof.
- **Possible outcomes:**
  - `matched_demo_record`
  - `pending_or_delayed`
  - `mismatch`
  - `unverified`
  - `potentially_suspicious`
- **How the matching works:** the rules are deterministic and are listed at the top of `verification_service.py`.
- **A missing record is never called fraud.** It may simply be delayed.
- **Demo assets:** `python -m scripts.make_demo_screenshots` writes labelled synthetic screenshots to `demo_assets/`. `demo_assets/README.md` says which outcome each one should produce, including the delayed-transfer sequence.

---

## 10. Voice entry

Speech-to-text runs in the **browser**, for example with the Web Speech API. There is no audio backend.

1. The browser sends the transcript to `POST /ai/parse-transaction` with `"input_mode": "voice"`.
2. The user reviews the returned draft and confirms it.
3. The confirm body is saved with `source: "voice"`.

Typed entry always works as well.

---

## 11. Tests

Run from `backend/` with the venv active:

```powershell
python -m pytest
```

- **Database:** the suite starts a throwaway local PostgreSQL with `pgserver`, so no Docker is needed. It applies the real migration and simulates Supabase's `anon` and `authenticated` roles. You can set `TEST_DATABASE_URL` to use another empty database. **That database is wiped**, so never point it at real data.
- **Gemini:** replaced by a scripted fake, so tests are free and offline. `scripts/check_gemini.py` is the live check.
- **Coverage:** health and config, auth and workspace isolation, row-level-security lockdown, all accounting rules, a parallel-payment race, idempotency, dashboard and report consistency, AI parsing, assistant grounding, insights, Gemini error mapping, upload validation, every screenshot outcome, Dummy Bank imports, receipts and demo data.

---

## 12. Deploy the backend to Render

1. Render → **New → Web Service** → connect the GitHub repository.
2. Fill in these settings:

   | Setting | Value |
   |---|---|
   | Root Directory | `backend` |
   | Runtime | Python 3. Version 3.12 comes from `backend/.python-version`, or set the `PYTHON_VERSION` env var to `3.12.10` |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
   | Health Check Path | `/api/v1/health` |

3. Under **Environment**, add the following. Never commit them.

   | Variable | Value |
   |---|---|
   | `APP_ENV` | `production` |
   | `DATABASE_URL` | the Session pooler URI |
   | `SUPABASE_URL` | your project URL |
   | `SUPABASE_JWT_SECRET` | only for legacy projects |
   | `GEMINI_API_KEY` | your key |
   | `GEMINI_MODEL` | your model |
   | `FRONTEND_ORIGINS` | `https://<your-app>.vercel.app` |
   | `DEV_AUTH_BYPASS` | `false` |

4. Deploy, then test:
   - `https://<service>.onrender.com/api/v1/health` returns 200.
   - `/api/v1/health/ready` returns `"status": "ready"`.
   - `/docs` loads, and authorised calls work with a real token.
5. **The free tier sleeps when idle**, and the first request after sleeping can take about a minute. Open `/api/v1/health` a few minutes before presenting.

## 13. Connect the Vercel frontend

1. In Vercel → Project → **Settings → Environment Variables**, add:

   | Variable | Value |
   |---|---|
   | `VITE_API_BASE_URL` | `https://<service>.onrender.com/api/v1` |
   | `VITE_SUPABASE_URL` | your project URL |
   | `VITE_SUPABASE_ANON_KEY` | the publishable/anon key |

2. **Never** put the Gemini key, the DB password or a service-role key in any `VITE_` variable. Vite bundles those into public JavaScript.
3. Redeploy the frontend, and add its exact URL to the backend's `FRONTEND_ORIGINS`.
4. Use a fetch helper like this one:

```js
const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/transactions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
    "Idempotency-Key": crypto.randomUUID(),   // one per Save click
  },
  body: JSON.stringify(draftBody),
});
if (!res.ok) { const { error } = await res.json(); showError(error.message); }
```

---

## 14. Known limitations

| Limitation | Detail |
|---|---|
| No real bank connection | The Dummy Bank is synthetic by design |
| No profit figure | There is no cost-of-goods-sold model |
| No inventory, invoices or refunds | Not in this version |
| Advances are not netted | Advances are not automatically netted against later bills |
| Rate limiting is in-memory | It is per server instance |
| No team UI | Each user gets their own shop. The schema supports `member` roles, but there is no invitation UI |
| Gemini is verified only by mocked tests | `GEMINI_MODEL` must be a model available to your key. Run `scripts/check_gemini.py` |
| Supabase is verified only locally | Tests run on local PostgreSQL 16, not the hosted project. Run the migration and `/health/ready` against your project before relying on it |
