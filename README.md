# Online Exam Portal (React + Node + Supabase Postgres)

## Local setup
1. **Supabase**: project banao -> SQL Editor -> `server/schema.sql` paste karke RUN.
2. **Backend**: `cd server && cp .env.example .env` -> `.env` me `DATABASE_URL` aur `JWT_SECRET` bharo -> `npm install && npm start`
3. **Frontend**: `cd client && cp .env.example .env` -> `npm install && npm run dev:chrome` (Chrome me khulega)
4. Website par register karo, phir Supabase SQL Editor me:
   `update users set role='admin' where email='your@email.com';` -> logout/login.

## Features
- JWT login, student/admin roles
- Admin: exam + MCQ create, sabhi results dekhna
- Server-side timer + auto-submit, auto-evaluation (correct answers client ko nahi jaate)
- Anti-cheat: tab switch, fullscreen exit detect; copy/paste/right-click block; 3 violations par auto-submit
