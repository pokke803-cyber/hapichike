# Archived Supabase SQL

Files in this directory are retained for design history only. They are outside
`supabase/migrations/` and do not use an executable `.sql` extension, so the
Supabase migration runner must not apply them.

- `20260919_initial_hapichike_schema.sql.archived`: original combined
  HAPICHIKE/common schema draft. It has not been converted to the planned
  `hapichike_*` names and must not be executed against the shared database.
