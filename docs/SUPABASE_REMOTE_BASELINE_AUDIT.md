# Project

- Audit date: 2026-10-01 (Asia/Tokyo)
- Intended target: staging
- Accessible project returned by `supabase projects list`: `pokke-family-apps` (`rrdokjeuwewphmlncguq`, ap-northeast-1)
- Dashboard classification: `main PRODUCTION`
- Result: **STOPPED**. The project was unlinked immediately after the Dashboard identified it as production. No staging project was available in the logged-in account's project list.
- Current local link state: unlinked

The project ref above is recorded only to explain why the audit stopped and to prevent the same target from being mistaken for staging again. It must not be used as the staging target.

# Migration history

`npx supabase migration list` was run once after linking, before the Dashboard classification was visible. It was a read-only request. The output was:

| Version | Migration name | Local | Remote |
|---|---|---:|---:|
| `202609290001` | `common_family_core` | yes | no |
| `202609290002` | `migrate_children_to_household` | yes | no |

- Local only: both versions above
- Remote only: none shown
- Present in both: none
- The two current local migrations were not present in the queried remote migration history.
- Important: this result belongs to the project later identified as production, not to an approved staging project. It cannot be used as the staging baseline audit result.

# PostgreSQL version

- The project list API reported database version `17.6.1.166` and PostgreSQL engine major version `17` for the project later identified as production.
- Approved staging PostgreSQL version: **UNKNOWN / 要確認**
- The local `supabase/config.toml` major version is `17`.

# profiles schema

**UNKNOWN / 要確認 for staging.**

The Dashboard revealed that the linked target was production before any catalog query was run. Therefore columns, data types, nullability, defaults, primary key, foreign keys, unique constraints, indexes, RLS state, policies, triggers, and the `id` / `display_name` / `auth.users` relationship were not queried.

# children schema

**UNKNOWN / 要確認 for staging.**

The Dashboard revealed that the linked target was production before any catalog query was run. Therefore columns, data types, nullability, defaults, primary key, foreign keys, unique constraints, indexes, RLS state, policies, triggers, and the `id` / `parent_id` / `household_id` / `name` / `nickname` definitions were not queried.

# Foreign keys

**UNKNOWN / 要確認 for staging.** In particular, `profiles.id -> auth.users.id`, `children.parent_id -> profiles.id`, and their delete actions remain unverified.

# RLS

**UNKNOWN / 要確認 for staging.** No staging table RLS metadata was queried.

# Policies

**UNKNOWN / 要確認 for staging.** No staging policy metadata was queried.

# Functions

**UNKNOWN / 要確認 for staging.** No staging function definitions or dependencies were queried.

# Triggers

**UNKNOWN / 要確認 for staging.** No staging trigger metadata was queried.

# Grants

**UNKNOWN / 要確認 for staging.** No staging table, sequence, or function grants were queried.

# Row counts

- staging `profiles`: **UNKNOWN / 要確認**
- staging `children`: **UNKNOWN / 要確認**

`supabase inspect db table-stats --linked` returned estimated row counts of 0 for both tables before the target was identified as production. These estimates are not accepted as staging row counts and no row data was displayed.

# Differences from local assumptions

- The documented assumption that the available remote target was staging was not confirmed. The only accessible project was explicitly labeled `main PRODUCTION` in the Dashboard.
- The queried production migration history did not contain either current local migration.
- The production project API reported PostgreSQL major version 17, matching local configuration, but staging compatibility remains unknown.
- All staging schema assumptions for `profiles`, `children`, related constraints, indexes, sequences, enum/type objects, RLS, policies, functions, triggers, and grants remain unverified.

# Baseline implications

Baseline generation must not proceed from this audit. There is no verified staging source, and production is outside the authorized scope. The migration list and PostgreSQL version observed for production must not be substituted for staging evidence.

No remote mutation command was run. Specifically, no `db push`, `db reset --linked`, `migration repair`, `db pull`, or modifying SQL (`DROP`, `ALTER`, `CREATE`, `INSERT`, `UPDATE`, `DELETE`) was executed. The attempted schema-only `db dump` stopped locally because no Docker/Podman runtime was available and produced no dump file.

# Next step

Provide or grant access to an explicitly identified staging Supabase project ref. Confirm in the Dashboard that its branch/environment is not labeled production. Then repeat login/link and the read-only audit against that staging ref. Baseline generation may proceed only after the staging migration history, exact row counts, PostgreSQL version, and all requested schema objects are verified.
