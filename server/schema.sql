-- Supabase Dashboard -> SQL Editor -> New query -> poora paste karke RUN (sirf ek baar)

create table if not exists users(
  id serial primary key,
  name varchar(100) not null,
  email varchar(150) unique not null,
  password varchar(255) not null,
  role varchar(10) not null default 'student' check (role in ('student','admin'))
);

create table if not exists exams(
  id serial primary key,
  title varchar(150) not null,
  duration_min int not null check (duration_min > 0)
);

create table if not exists questions(
  id serial primary key,
  exam_id int not null references exams(id) on delete cascade,
  text text not null,
  a varchar(255) not null, b varchar(255) not null, c varchar(255) not null, d varchar(255) not null,
  correct char(1) not null check (correct in ('a','b','c','d'))
);

create table if not exists attempts(
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  exam_id int not null references exams(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score int not null default 0,
  total int not null default 0,
  violations int not null default 0,
  unique (user_id, exam_id)
);

-- SECURITY: Supabase ki public API se tables (password hash samet) koi na padh sake.
-- Backend direct Postgres connection use karta hai, isliye isse koi farak nahi padta.
alter table users     enable row level security;
alter table exams     enable row level security;
alter table questions enable row level security;
alter table attempts  enable row level security;

-- Sample exam
with e as (insert into exams(title,duration_min) values('Sample: Basic CS Quiz',5) returning id)
insert into questions(exam_id,text,a,b,c,d,correct)
select e.id, v.t, v.a, v.b, v.c, v.d, v.correct
from e, (values
  ('Which data structure uses LIFO?','Queue','Stack','Tree','Graph','b'),
  ('Time complexity of binary search?','O(n)','O(n^2)','O(log n)','O(1)','c'),
  ('SQL command to remove a table?','DELETE','REMOVE','DROP','CLEAR','c')
) as v(t,a,b,c,d,correct);

-- Admin banane ke liye (pehle website par register karo, phir ye chalao):
-- update users set role='admin' where email='your@email.com';
