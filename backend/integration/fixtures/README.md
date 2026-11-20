# Historical upgrade fixture

`schema-ec5e1bd.sql` is an exact source snapshot from leejw0010/Jobseeker commit `ec5e1bd8270947e3e02c13521c1b4716414bd698`, path `supabase/schema.sql`. It contains DDL only and is applied only to the disposable PostgreSQL test database.

The integration fixture validates its SHA256 before use. Keeping this snapshot in the team repository removes the original test harness dependency on another repository's Git object history. No deployed migration is edited and no real database is read.
