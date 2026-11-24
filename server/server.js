require('dotenv').config();
const express = require('express'), cors = require('cors'), { Pool } = require('pg');
const jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) { console.error('ERROR: DATABASE_URL .env me set karo (Supabase connection string)'); process.exit(1); }
if (!process.env.JWT_SECRET) { console.error('ERROR: JWT_SECRET .env me set karo'); process.exit(1); }
const SECRET = process.env.JWT_SECRET;

const app = express();
const origins = (process.env.CLIENT_URL || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : '*' }));
app.use(express.json({ limit: '1mb' }));

// Supabase Postgres (SSL required)
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });

const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); next(); }
  catch { res.status(401).json({ error: 'Login required' }); }
};
const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });
const elapsedOf = col => `FLOOR(EXTRACT(EPOCH FROM (NOW()-${col})))::int`;

app.get('/', (req, res) => res.json({ ok: true, service: 'exam-portal-api' }));

app.post('/api/register', wrap(async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password kam se kam 6 characters ka rakho' });
  const ex = await q('SELECT id FROM users WHERE email=$1', [email]);
  if (ex.length) return res.status(400).json({ error: 'Email already used' });
  const hash = await bcrypt.hash(password, 10);
  // Sab student banenge. Admin banane ke liye Supabase SQL Editor me:
  // UPDATE users SET role='admin' WHERE email='your@email.com';
  await q('INSERT INTO users(name,email,password,role) VALUES($1,$2,$3,$4)', [name, email, hash, 'student']);
  res.json({ ok: true });
}));

app.post('/api/login', wrap(async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const r = await q('SELECT * FROM users WHERE email=$1', [email]);
  if (!r.length || !(await bcrypt.compare(password, r[0].password)))
    return res.status(400).json({ error: 'Wrong email or password' });
  const u = r[0];
  const token = jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '1d' });
  res.json({ token, user: { id: u.id, name: u.name, role: u.role } });
}));

app.get('/api/exams', auth, wrap(async (req, res) => {
  const r = await q(`SELECT e.*,
      (SELECT COUNT(*)::int FROM questions q WHERE q.exam_id=e.id) AS qcount,
      (SELECT COUNT(*)::int FROM attempts a WHERE a.exam_id=e.id AND a.user_id=$1 AND a.submitted_at IS NOT NULL) AS done
    FROM exams e ORDER BY e.id`, [req.user.id]);
  res.json(r);
}));

// Exam start: attempt banata hai (ya purana resume), questions bina correct answer ke bhejta hai
app.post('/api/exams/:id/start', auth, wrap(async (req, res) => {
  const eid = parseInt(req.params.id, 10);
  if (!eid) return res.status(400).json({ error: 'Invalid exam' });
  const ex = await q('SELECT * FROM exams WHERE id=$1', [eid]);
  if (!ex.length) return res.status(404).json({ error: 'Exam not found' });
  await q('INSERT INTO attempts(user_id,exam_id) VALUES($1,$2) ON CONFLICT (user_id,exam_id) DO NOTHING', [req.user.id, eid]);
  const [att] = await q(`SELECT id,submitted_at,violations,${elapsedOf('started_at')} AS elapsed FROM attempts WHERE user_id=$1 AND exam_id=$2`, [req.user.id, eid]);
  if (att.submitted_at) return res.status(400).json({ error: 'Exam already submitted' });
  const remaining = Math.max(0, ex[0].duration_min * 60 - att.elapsed);
  const qs = await q('SELECT id,text,a,b,c,d FROM questions WHERE exam_id=$1 ORDER BY id', [eid]);
  res.json({ attemptId: att.id, title: ex[0].title, remaining, violations: att.violations, questions: qs });
}));

app.post('/api/attempts/:id/violation', auth, wrap(async (req, res) => {
  const r = await q('UPDATE attempts SET violations=violations+1 WHERE id=$1 AND user_id=$2 AND submitted_at IS NULL RETURNING violations', [req.params.id, req.user.id]);
  res.json({ violations: r.length ? r[0].violations : 0 });
}));

// Submit: server-side evaluation (10s grace network delay ke liye)
app.post('/api/attempts/:id/submit', auth, wrap(async (req, res) => {
  const att = await q(`SELECT a.*,e.duration_min,${elapsedOf('a.started_at')} AS elapsed
    FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=$1 AND a.user_id=$2`, [req.params.id, req.user.id]);
  if (!att.length) return res.status(404).json({ error: 'Attempt not found' });
  if (att[0].submitted_at) return res.status(400).json({ error: 'Already submitted' });
  const answers = req.body.answers || {};
  const qs = await q('SELECT id,correct FROM questions WHERE exam_id=$1', [att[0].exam_id]);
  const late = att[0].elapsed > att[0].duration_min * 60 + 10;
  let score = 0;
  if (!late) qs.forEach(x => { if (answers[x.id] === x.correct) score++; });
  const upd = await q('UPDATE attempts SET submitted_at=NOW(),score=$1,total=$2 WHERE id=$3 AND submitted_at IS NULL RETURNING id', [score, qs.length, att[0].id]);
  if (!upd.length) return res.status(400).json({ error: 'Already submitted' });
  res.json({ score, total: qs.length, late });
}));

app.get('/api/results', auth, wrap(async (req, res) => {
  const base = `SELECT a.id,a.score,a.total,a.violations,a.submitted_at,e.title,u.name
    FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.user_id WHERE a.submitted_at IS NOT NULL`;
  const r = req.user.role === 'admin'
    ? await q(base + ' ORDER BY a.submitted_at DESC')
    : await q(base + ' AND a.user_id=$1 ORDER BY a.submitted_at DESC', [req.user.id]);
  res.json(r);
}));

// Admin: exam + questions create (transaction me, adha save nahi hoga)
app.post('/api/exams', auth, adminOnly, wrap(async (req, res) => {
  const { title, duration_min, questions } = req.body;
  const dur = parseInt(duration_min, 10);
  const valid = Array.isArray(questions) && questions.length &&
    questions.every(x => x && x.text && x.a && x.b && x.c && x.d && ['a', 'b', 'c', 'd'].includes(x.correct));
  if (!title || !dur || dur < 1 || !valid) return res.status(400).json({ error: 'Invalid data: har question me text, 4 options aur correct answer chahiye' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const e = await c.query('INSERT INTO exams(title,duration_min) VALUES($1,$2) RETURNING id', [title, dur]);
    const id = e.rows[0].id;
    for (const x of questions)
      await c.query('INSERT INTO questions(exam_id,text,a,b,c,d,correct) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, x.text, x.a, x.b, x.c, x.d, x.correct]);
    await c.query('COMMIT');
    res.json({ ok: true, id });
  } catch (err) { await c.query('ROLLBACK'); throw err; }
  finally { c.release(); }
}));

app.listen(process.env.PORT || 5000, () => console.log('Server running on port ' + (process.env.PORT || 5000)));
