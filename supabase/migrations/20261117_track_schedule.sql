-- Track schedule: a posting's deadline and the next step (aptitude test, interview) with its date.
-- Additive and safe to run again. The app checks these columns at startup and stops with this file's name if missing.
alter table applications add column if not exists deadline date;
alter table applications add column if not exists next_step_on date;
alter table applications add column if not exists next_step text;
