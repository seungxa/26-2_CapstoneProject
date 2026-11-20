-- Read-only precheck before applying the JobSeeker Practice/Track schema to a Supabase project.
-- Paste the whole file into Supabase -> SQL Editor and press Run. It only reads the catalog: nothing is changed.
-- The first row is the verdict:
--   NEW      none of the app tables exist      -> run supabase/schema.sql once, then supabase/migrations/*.sql in order
--   UPGRADE  the app's first 7 tables exist    -> run supabase/migrations/*.sql in order (never schema.sql again)
--   STOP     a name is taken by something else -> run nothing; share this result
-- What each row means and what to do next: docs/practice-track/supabase-apply.md
with expected(ord, tbl, base, cols) as (values
  -- base = in the first schema of the app; cols = columns that show a table is the app's (not all of them)
  (1, 'questions', true, array['id', 'user_id', 'category', 'text', 'source']),
  (2, 'practice_sessions', true, array['id', 'user_id', 'mode']),
  (3, 'practice_answers', true, array['id', 'session_id', 'question_id', 'order_no']),
  (4, 'applications', true, array['id', 'user_id', 'company', 'position']),
  (5, 'stage_events', true, array['id', 'application_id', 'stage']),
  (6, 'essay_items', true, array['id', 'application_id', 'question_text']),
  (7, 'answer_versions', true, array['id', 'essay_item_id', 'version_no', 'content']),
  (8, 'user_settings', false, array['user_id', 'keep_audio']),
  (9, 'practice_private_questions', false, array['question_id']),
  (10, 'practice_contexts', false, array['session_id']),
  (11, 'answer_coaching', false, array['answer_id']),
  (12, 'question_competencies', false, array['question_id', 'competency_key']),
  (13, 'application_states', false, array['application_id', 'revision']),
  (14, 'essay_submissions', false, array['id', 'essay_item_id', 'version_id'])
),
found as (
  select e.ord, e.tbl, e.base, e.cols, c.oid, coalesce(c.relrowsecurity, false) as rls,
         coalesce((select array_agg(a.attname::text) from pg_attribute a
                   where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '{}'::text[]) as actual
  from expected e
  left join pg_class c on c.relname = e.tbl and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
),
judged as (
  select ord, tbl, base, rls, oid is not null as present,
         array(select col from unnest(cols) as col where col <> all(actual)) as missing
  from found
),
names as (
  select exists(select 1 from pg_policies
                where schemaname = 'storage' and tablename = 'objects' and policyname = 'rec_own') as rec_own,
         exists(select 1 from pg_proc
                where proname = 'protect_answer_version_history' and pronamespace = 'public'::regnamespace) as guard_fn,
         exists(select 1 from storage.buckets where id = 'recordings' and public) as public_bucket
),
summary as (
  select count(*) filter (where present) as n_present,
         count(*) filter (where present and cardinality(missing) > 0) as n_conflict,
         count(*) filter (where base and present and cardinality(missing) = 0) as n_base_ours,
         count(*) filter (where base) as n_base
  from judged
),
verdict as (
  select case
           when s.n_conflict > 0 or n.public_bucket then 'STOP'
           when s.n_present = 0 and (n.rec_own or n.guard_fn) then 'STOP'
           when s.n_present = 0 then 'NEW'
           when s.n_base_ours = s.n_base then 'UPGRADE'
           else 'STOP'
         end as status
  from summary s cross join names n
),
report(sort, section, item, status, detail) as (
  select 0, 'verdict', 'next step', v.status,
         case v.status
           when 'NEW' then 'None of the app tables exist: run supabase/schema.sql once, then every file in '
                           'supabase/migrations in file-name order.'
           when 'UPGRADE' then 'The app tables exist: run every file in supabase/migrations in file-name order '
                               '(safe to run again). Do not run schema.sql again.'
           else 'Do not run anything. Share this result: a name belongs to another object, the recordings bucket '
                'is public, or only part of the app schema exists.'
         end
  from verdict v
  union all
  select ord, 'table', tbl,
         case when not present then 'absent' when cardinality(missing) > 0 then 'CONFLICT' else 'ours' end,
         case when not present then ''
              when cardinality(missing) > 0 then 'another table: missing app columns ' || array_to_string(missing, ', ')
              when rls then 'RLS on'
              else 'RLS off: run  alter table public.' || tbl || ' enable row level security;' end
  from judged
  union all
  select 20, 'storage', 'bucket recordings',
         case when b.id is null then 'absent' else 'present' end,
         case when b.id is null then 'NEW: schema.sql adds it as a private bucket. UPGRADE: add it by hand '
                                     '(supabase-apply.md 5)'
              when b.public then 'PUBLIC: anyone with a file link can read recordings; make it private first'
              else 'private' end
  from (select 1) as one left join storage.buckets b on b.id = 'recordings'
  union all
  select 21, 'storage', 'policy rec_own on storage.objects',
         case when rec_own then 'present' else 'absent' end, ''
  from names
  union all
  select 22, 'function', 'public.protect_answer_version_history',
         case when guard_fn then 'present' else 'absent' end, ''
  from names
  union all
  select 30, 'profiles', 'public.profiles',
         case when c.oid is null then 'absent' else 'present' end,
         case when c.oid is null then 'not used by this schema'
              else 'columns ' || (select string_agg(a.attname::text, ', ' order by a.attnum) from pg_attribute a
                                  where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
                   || '; RLS ' || case when c.relrowsecurity then 'on' else 'off' end
                   || '; ' || (select count(*) from pg_policies p
                               where p.schemaname = 'public' and p.tablename = 'profiles') || ' policies'
                   || '; this schema leaves it as it is' end
  from (select 1) as one
  left join pg_class c on c.relname = 'profiles' and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
)
select section, item, status, detail from report order by sort;
