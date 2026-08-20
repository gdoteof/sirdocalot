-- Briefs, their participants, and what came back.
--
-- Blocks, participants, policy and intent are jsonb rather than tables. They are
-- written as one document by one code path, always read whole, and never queried
-- by their internals -- so normalising them would buy joins nobody performs and
-- cost a migration every time the primitive set grows.

create table if not exists briefs (
    id            text        primary key,
    title         text        not null,
    blocks        jsonb       not null,
    participants  jsonb       not null,
    policy        jsonb       not null,
    intent        jsonb       not null,
    created_at    timestamptz not null,
    closed_at     timestamptz,
    closed_reason text
);

-- No unique constraint on (brief_id, participant_id): resubmission is a
-- correction, and the domain takes the latest. Keeping the earlier rows means a
-- participant who changed their mind leaves a record that they did.
create table if not exists responses (
    id             bigserial   primary key,
    brief_id       text        not null references briefs (id) on delete cascade,
    participant_id text        not null,
    submitted_at   timestamptz not null,
    answers        jsonb       not null
);

create index if not exists responses_by_brief on responses (brief_id, submitted_at);

-- The registry. Rows here are what an agent adds to when it needs a widget the
-- library has not got, which is why this is data and not a module.
create table if not exists widgets (
    name       text        primary key,
    summary    text        not null,
    props      jsonb       not null,
    layout     jsonb       not null,
    builtin    boolean     not null default false,
    updated_at timestamptz not null default now()
);
