-- =====================================================================
-- DukaanDiary AI - initial database schema
-- Apply once in the Supabase SQL Editor (or with scripts/apply_migrations.py).
--
-- Accounting model (summary - see backend/README.md for the full rules):
--   * A row in `transactions` is an OBLIGATION: a sale, purchase or expense
--     for a total `amount`. It never says by itself that money moved.
--   * Money moves ONLY through rows in `payments`.
--     Cash sale  = 1 transaction + 1 completed payment for the full amount.
--     Credit sale = 1 transaction + no payment (or a partial one).
--   * Outstanding balance = transaction.amount - SUM(completed payments).
--     Balances are always calculated, never stored, so they cannot drift.
--   * Pending, failed and cancelled payments never count as money received or paid.
--
-- Security model:
--   * The FastAPI backend connects with a server-side connection string and
--     checks workspace membership on EVERY request.
--   * Row Level Security is enabled on every table with NO policies, and all
--     privileges are revoked from the `anon` and `authenticated` roles.
--     So the public Supabase Data API (used with the anon key in a browser)
--     cannot read or write any of this data. Only the backend can.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Users and shops
-- ---------------------------------------------------------------------
create table public.profiles (
    id          uuid primary key,              -- the Supabase Auth user id (auth.users.id)
    email       text,
    full_name   text,
    created_at  timestamptz not null default now()
);

create table public.workspaces (
    id          uuid primary key default gen_random_uuid(),
    name        text not null check (char_length(name) between 1 and 120),
    currency    char(3) not null default 'PKR',
    timezone    text not null default 'Asia/Karachi',
    created_by  uuid not null references public.profiles(id),
    created_at  timestamptz not null default now()
);

create table public.workspace_members (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id      uuid not null references public.profiles(id) on delete cascade,
    role         text not null default 'owner' check (role in ('owner', 'member')),
    created_at   timestamptz not null default now(),
    primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------
-- Customers and suppliers
-- ---------------------------------------------------------------------
create table public.contacts (
    id           uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    kind         text not null check (kind in ('customer', 'supplier')),
    name         text not null check (char_length(btrim(name)) between 1 and 120),
    phone        text check (phone is null or char_length(phone) <= 30),
    notes        text check (notes is null or char_length(notes) <= 1000),
    is_demo      boolean not null default false,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
-- One "Ahmed" customer per shop (case-insensitive) prevents accidental duplicates.
create unique index contacts_workspace_kind_name_uq
    on public.contacts (workspace_id, kind, lower(btrim(name)));

-- ---------------------------------------------------------------------
-- Transactions (obligations: sales, purchases, expenses)
-- ---------------------------------------------------------------------
create table public.transactions (
    id               uuid primary key default gen_random_uuid(),
    workspace_id     uuid not null references public.workspaces(id) on delete cascade,
    type             text not null check (type in ('sale', 'purchase', 'expense')),
    category         text not null default 'general'
                         check (char_length(category) between 1 and 60),
    description      text not null check (char_length(description) between 1 and 500),
    notes            text check (notes is null or char_length(notes) <= 2000),
    amount           numeric(14, 2) not null check (amount > 0),
    currency         char(3) not null default 'PKR' check (currency = 'PKR'),
    transaction_date date not null,
    due_date         date check (due_date is null or due_date >= transaction_date),
    contact_id       uuid references public.contacts(id) on delete restrict,
    source           text not null default 'manual'
                         check (source in ('manual', 'ai', 'voice', 'receipt', 'dummy_bank', 'demo_seed')),
    receipt_ref      text check (receipt_ref is null or char_length(receipt_ref) <= 500),
    is_demo          boolean not null default false,
    idempotency_key  text check (idempotency_key is null or char_length(idempotency_key) <= 100),
    created_by       uuid references public.profiles(id),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    deleted_at       timestamptz            -- soft delete ("void"): excluded from every total
);
create unique index transactions_idempotency_uq
    on public.transactions (workspace_id, idempotency_key) where idempotency_key is not null;
create index transactions_workspace_date_idx
    on public.transactions (workspace_id, transaction_date desc, created_at desc)
    where deleted_at is null;
create index transactions_contact_idx on public.transactions (contact_id);

-- ---------------------------------------------------------------------
-- Dummy Bank (SYNTHETIC demo data - no real bank connection)
-- ---------------------------------------------------------------------
create table public.dummy_bank_accounts (
    id                    uuid primary key default gen_random_uuid(),
    workspace_id          uuid not null references public.workspaces(id) on delete cascade,
    bank_name             text not null,
    account_title         text not null,
    account_number_masked text not null,
    is_synthetic          boolean not null default true check (is_synthetic),
    created_at            timestamptz not null default now()
);
create index dummy_bank_accounts_workspace_idx on public.dummy_bank_accounts (workspace_id);

create table public.dummy_bank_transactions (
    id                          uuid primary key default gen_random_uuid(),
    workspace_id                uuid not null references public.workspaces(id) on delete cascade,
    account_id                  uuid not null references public.dummy_bank_accounts(id) on delete cascade,
    reference                   text not null check (char_length(reference) between 3 and 64),
    direction                   text not null check (direction in ('in', 'out')),
    amount                      numeric(14, 2) not null check (amount > 0),
    currency                    char(3) not null default 'PKR',
    counterparty_name           text not null,
    counterparty_account_masked text,
    description                 text,
    status                      text not null check (status in ('completed', 'pending', 'failed', 'cancelled')),
    occurred_at                 timestamptz not null,
    is_synthetic                boolean not null default true check (is_synthetic),
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now()
);
create unique index dummy_bank_transactions_reference_uq
    on public.dummy_bank_transactions (workspace_id, upper(reference));
create index dummy_bank_transactions_occurred_idx
    on public.dummy_bank_transactions (workspace_id, occurred_at desc);

-- One import per demo bank transaction, ever. This UNIQUE constraint is what
-- makes duplicate imports impossible even if two requests race each other.
create table public.dummy_bank_imports (
    id                        uuid primary key default gen_random_uuid(),
    workspace_id              uuid not null references public.workspaces(id) on delete cascade,
    dummy_bank_transaction_id uuid not null unique
                                  references public.dummy_bank_transactions(id) on delete restrict,
    mode                      text not null check (mode in ('settle_transaction', 'settle_contact', 'new_transaction')),
    created_transaction_id    uuid references public.transactions(id) on delete restrict,
    imported_by               uuid references public.profiles(id),
    imported_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Payments (the only place money moves)
-- ---------------------------------------------------------------------
create table public.payments (
    id                   uuid primary key default gen_random_uuid(),
    workspace_id         uuid not null references public.workspaces(id) on delete cascade,
    -- The obligation this payment settles. NULL only for an advance (see contact_id).
    transaction_id       uuid references public.transactions(id) on delete cascade,
    contact_id           uuid references public.contacts(id) on delete restrict,
    direction            text not null check (direction in ('in', 'out')),  -- in = money received
    amount               numeric(14, 2) not null check (amount > 0),
    payment_date         date not null,
    method               text not null check (method in ('cash', 'bank', 'mobile_wallet', 'cheque', 'other')),
    status               text not null default 'completed'
                             check (status in ('completed', 'pending', 'failed', 'cancelled')),
    reference            text check (reference is null or char_length(reference) <= 100),
    notes                text check (notes is null or char_length(notes) <= 1000),
    dummy_bank_import_id uuid references public.dummy_bank_imports(id) on delete restrict,
    is_demo              boolean not null default false,
    idempotency_key      text check (idempotency_key is null or char_length(idempotency_key) <= 120),
    created_by           uuid references public.profiles(id),
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    -- A payment must settle an obligation, or be an advance tied to a contact.
    constraint payments_target_chk check (transaction_id is not null or contact_id is not null)
);
create unique index payments_idempotency_uq
    on public.payments (workspace_id, idempotency_key) where idempotency_key is not null;
create index payments_transaction_idx on public.payments (transaction_id);
create index payments_workspace_date_idx on public.payments (workspace_id, payment_date desc);
create index payments_contact_idx on public.payments (contact_id);

-- ---------------------------------------------------------------------
-- Screenshot check history (stores extracted fields and results, never the image)
-- ---------------------------------------------------------------------
create table public.payment_verifications (
    id                                 uuid primary key default gen_random_uuid(),
    workspace_id                       uuid not null references public.workspaces(id) on delete cascade,
    outcome                            text not null check (outcome in (
                                           'matched_demo_record', 'pending_or_delayed', 'mismatch',
                                           'unverified', 'potentially_suspicious')),
    confidence                         text not null check (confidence in ('high', 'medium', 'low')),
    extracted                          jsonb not null,
    comparison                         jsonb not null,
    explanation                        text not null,
    matched_dummy_bank_transaction_id  uuid references public.dummy_bank_transactions(id) on delete set null,
    created_by                         uuid references public.profiles(id),
    created_at                         timestamptz not null default now()
);
create index payment_verifications_workspace_idx
    on public.payment_verifications (workspace_id, created_at desc);

-- ---------------------------------------------------------------------
-- Lock down the public Data API (anon / authenticated roles).
-- RLS on + no policies = deny everything for those roles.
-- The backend's server-side connection is not affected.
-- ---------------------------------------------------------------------
alter table public.profiles                enable row level security;
alter table public.workspaces              enable row level security;
alter table public.workspace_members       enable row level security;
alter table public.contacts                enable row level security;
alter table public.transactions            enable row level security;
alter table public.payments                enable row level security;
alter table public.dummy_bank_accounts     enable row level security;
alter table public.dummy_bank_transactions enable row level security;
alter table public.dummy_bank_imports      enable row level security;
alter table public.payment_verifications   enable row level security;

revoke all on table
    public.profiles, public.workspaces, public.workspace_members, public.contacts,
    public.transactions, public.payments, public.dummy_bank_accounts,
    public.dummy_bank_transactions, public.dummy_bank_imports, public.payment_verifications
from anon, authenticated;

commit;
