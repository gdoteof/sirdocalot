-- Agents, the codes that let them in, and the short links participants follow.

-- We hold a public key and nothing else. A copy of this table lets an attacker
-- verify signatures, which is what verification is for, and produce none.
create table if not exists agents (
    id          text        primary key,
    name        text        not null,
    public_key  text        not null unique,
    created_at  timestamptz not null default now(),
    disabled_at timestamptz
);

-- Registration is gated because this runs on one small box that does not scale.
-- Codes are rows rather than one shared value in the environment so that a code
-- can be handed to one person, spent once, and traced afterwards.
create table if not exists invite_codes (
    code       text        primary key,
    note       text,
    created_at timestamptz not null default now(),
    used_by    text        references agents (id),
    used_at    timestamptz
);

-- Which agent a brief belongs to. Nullable: briefs created before agents existed
-- have no owner, and inventing one for them would be a lie about who made them.
alter table briefs add column if not exists agent_id text references agents (id);
create index if not exists briefs_by_agent on briefs (agent_id, created_at desc);

-- Participant links.
--
-- These were signed tokens carrying their own claims, which meant a 150-character
-- URL that wrapped in every mail client. The statelessness bought nothing: every
-- request loads the brief from this database anyway, so the signature was paying
-- for a round trip that already happened. A stored token is shorter, and it can be
-- revoked, which a signed one cannot.
create table if not exists participant_links (
    token          text        primary key,
    brief_id       text        not null references briefs (id) on delete cascade,
    participant_id text        not null,
    issued_at      timestamptz not null default now(),
    expires_at     timestamptz not null,
    revoked_at     timestamptz
);

create index if not exists participant_links_by_brief on participant_links (brief_id);
