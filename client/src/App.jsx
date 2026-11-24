import React, { useState, useEffect, useRef, useCallback } from 'react';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

async function api(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Server se connect nahi ho paya. Free server so raha ho sakta hai, 1 minute baad dobara try karo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Error'); e.status = res.status; throw e; }
  return data;
}

const exitFs = () => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* ---------------- Login / Register ---------------- */
function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState(''), [info, setInfo] = useState(''), [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });

  const submit = async e => {
    e.preventDefault(); setErr(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'register') {
        await api('/api/register', { method: 'POST', body: f });
        setMode('login'); setInfo('Register ho gaya! Ab login karo.');
      } else {
        const d = await api('/api/login', { method: 'POST', body: { email: f.email, password: f.password } });
        onLogin(d.token, d.user);
      }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="card">
      <h2>{mode === 'login' ? 'Login' : 'Register'}</h2>
      <form onSubmit={submit}>
        {mode === 'register' && <input placeholder="Name" value={f.name} onChange={set('name')} required />}
        <input type="email" placeholder="Email" value={f.email} onChange={set('email')} required />
        <input type="password" placeholder="Password (min 6)" value={f.password} onChange={set('password')} required />
        {err && <p className="warn">{err}</p>}
        {info && <p style={{ color: '#16a34a' }}>{info}</p>}
        <button disabled={busy}>{busy ? 'Wait...' : mode === 'login' ? 'Login' : 'Register'}</button>
        <button type="button" className="sec" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); setInfo(''); }}>
          {mode === 'login' ? 'Naya account banao' : 'Login par jao'}
        </button>
      </form>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
function Home({ token, user, onStart, onCreate, onLogout }) {
  const [exams, setExams] = useState([]), [results, setResults] = useState([]), [err, setErr] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([api('/api/exams', { token }), api('/api/results', { token })])
      .then(([e, r]) => { setExams(e); setResults(r); })
      .catch(e => { if (e.status === 401) onLogout(); else setErr(e.message); })
      .finally(() => setLoading(false));
  }, []);
  const isAdmin = user.role === 'admin';

  return (
    <>
      <div className="card top">
        <div><b>{user.name}</b> <small>({user.role})</small></div>
        <div>
          {isAdmin && <button onClick={onCreate}>+ Create Exam</button>}
          <button className="sec" onClick={onLogout}>Logout</button>
        </div>
      </div>
      {err && <p className="warn">{err}</p>}
      {loading && <p>Loading...</p>}

      <div className="card">
        <h3>Exams</h3>
        {!loading && !exams.length && <p>Abhi koi exam nahi hai.</p>}
        {exams.map(e => (
          <div key={e.id} className="top" style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
            <div><b>{e.title}</b><br /><small>{e.qcount} questions • {e.duration_min} min</small></div>
            {isAdmin ? <small>Admin</small>
              : e.done > 0 ? <small>✅ Completed</small>
              : <button onClick={() => onStart(e.id)}>Start</button>}
          </div>
        ))}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h3>{isAdmin ? 'All Results' : 'My Results'}</h3>
        {!loading && !results.length && <p>Abhi koi result nahi.</p>}
        {!!results.length && (
          <table>
            <thead><tr>{isAdmin && <th>Student</th>}<th>Exam</th><th>Score</th><th>Violations</th><th>Date</th></tr></thead>
            <tbody>{results.map(r => (
              <tr key={r.id}>{isAdmin && <td>{r.name}</td>}<td>{r.title}</td><td>{r.score}/{r.total}</td><td>{r.violations}</td>
                <td>{new Date(r.submitted_at).toLocaleString()}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ---------------- Admin: create exam ---------------- */
const blankQ = () => ({ text: '', a: '', b: '', c: '', d: '', correct: 'a' });
function CreateExam({ token, onBack }) {
  const [title, setTitle] = useState(''), [dur, setDur] = useState(10), [qs, setQs] = useState([blankQ()]);
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const upd = (i, k, v) => setQs(qs.map((x, j) => j === i ? { ...x, [k]: v } : x));

  const save = async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api('/api/exams', { method: 'POST', token, body: { title, duration_min: Number(dur), questions: qs } });
      onBack();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <form onSubmit={save}>
      <div className="card">
        <h3>Create Exam</h3>
        <input placeholder="Exam title" value={title} onChange={e => setTitle(e.target.value)} required />
        <input type="number" min="1" placeholder="Duration (minutes)" value={dur} onChange={e => setDur(e.target.value)} required />
      </div>
      {qs.map((x, i) => (
        <div className="card" key={i}>
          <div className="top"><b>Question {i + 1}</b>
            {qs.length > 1 && <button type="button" className="red" onClick={() => setQs(qs.filter((_, j) => j !== i))}>Remove</button>}
          </div>
          <textarea rows="2" placeholder="Question text" value={x.text} onChange={e => upd(i, 'text', e.target.value)} required />
          {['a', 'b', 'c', 'd'].map(k => (
            <input key={k} placeholder={`Option ${k.toUpperCase()}`} value={x[k]} onChange={e => upd(i, k, e.target.value)} required />
          ))}
          <select value={x.correct} onChange={e => upd(i, 'correct', e.target.value)}>
            {['a', 'b', 'c', 'd'].map(k => <option key={k} value={k}>Correct: {k.toUpperCase()}</option>)}
          </select>
        </div>
      ))}
      {err && <p className="warn">{err}</p>}
      <button type="button" className="sec" onClick={() => setQs([...qs, blankQ()])}>+ Add question</button>
      <button disabled={busy}>{busy ? 'Saving...' : 'Save Exam'}</button>
      <button type="button" className="sec" onClick={onBack}>Cancel</button>
    </form>
  );
}

/* ---------------- Exam (timer + anti-cheat) ---------------- */
function Exam({ token, examId, onExit }) {
  const [data, setData] = useState(null), [answers, setAnswers] = useState({}), [idx, setIdx] = useState(0);
  const [left, setLeft] = useState(0), [viol, setViol] = useState(0), [warn, setWarn] = useState('');
  const [result, setResult] = useState(null), [confirming, setConfirming] = useState(false), [subErr, setSubErr] = useState('');
  const [isFs, setIsFs] = useState(!!document.fullscreenElement);

  const deadline = useRef(0), attemptId = useRef(null), answersRef = useRef({});
  const finished = useRef(false), failed = useRef(false), lastViol = useRef(0), vcount = useRef(0);

  // Exam load / resume
  useEffect(() => {
    let dead = false;
    api(`/api/exams/${examId}/start`, { method: 'POST', token })
      .then(d => {
        if (dead) return;
        attemptId.current = d.attemptId; vcount.current = d.violations || 0; setViol(vcount.current);
        deadline.current = Date.now() + d.remaining * 1000;
        setLeft(d.remaining); setData(d);
      })
      .catch(e => { alert(e.message); exitFs(); onExit(); });
    return () => { dead = true; };
  }, []);

  const submit = useCallback(async () => {
    if (finished.current) return;
    finished.current = true; failed.current = false; setSubErr('');
    try {
      const r = await api(`/api/attempts/${attemptId.current}/submit`, { method: 'POST', token, body: { answers: answersRef.current } });
      setResult(r); exitFs();
    } catch (e) { finished.current = false; failed.current = true; setSubErr(e.message); }
  }, [token]);

  // Timer (deadline-based, tab throttle se drift nahi hota)
  useEffect(() => {
    if (!data || result) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0 && !failed.current) submit();
    }, 500);
    return () => clearInterval(t);
  }, [data, result, submit]);

  // Violations
  const violation = useCallback(why => {
    if (finished.current) return;
    const now = Date.now();
    if (now - lastViol.current < 2000) return; // blur + visibilitychange dono ek saath aate hain
    lastViol.current = now;
    vcount.current += 1; setViol(vcount.current);
    setWarn(`⚠ ${why}. Violation ${Math.min(vcount.current, 3)}/3`);
    api(`/api/attempts/${attemptId.current}/violation`, { method: 'POST', token }).catch(() => {});
    if (vcount.current >= 3) submit();
  }, [token, submit]);

  // Anti-cheat listeners
  useEffect(() => {
    if (!data || result) return;
    const block = e => e.preventDefault();
    const onVis = () => { if (document.hidden) violation('Tab switch detect hua'); };
    const onBlur = () => violation('Exam window se focus hata');
    const onFs = () => {
      setIsFs(!!document.fullscreenElement);
      if (!document.fullscreenElement && document.fullscreenEnabled) violation('Fullscreen se bahar nikle');
    };
    const onUnload = e => { e.preventDefault(); e.returnValue = ''; };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('beforeunload', onUnload);
    ['copy', 'cut', 'paste', 'contextmenu'].forEach(ev => document.addEventListener(ev, block));
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('beforeunload', onUnload);
      ['copy', 'cut', 'paste', 'contextmenu'].forEach(ev => document.removeEventListener(ev, block));
    };
  }, [data, result, violation]);

  const pick = (qid, k) => { const n = { ...answers, [qid]: k }; answersRef.current = n; setAnswers(n); };

  if (result) return (
    <div className="card">
      <h2>Exam Submitted ✅</h2>
      {result.late
        ? <p className="warn">Time khatam hone ke baad submit hua, isliye score 0 hai.</p>
        : <p style={{ fontSize: 22 }}>Score: <b>{result.score}/{result.total}</b></p>}
      <button onClick={onExit}>Dashboard par jao</button>
    </div>
  );
  if (!data) return <div className="card">Exam load ho raha hai...</div>;

  const qn = data.questions, cur = qn[idx];
  return (
    <div className="nosel">
      <div className="card top">
        <b>{data.title}</b>
        <div style={{ textAlign: 'right' }}>
          <span className={'timer ' + (left < 60 ? 'warn' : '')}>⏱ {fmt(left)}</span><br />
          <small className={viol ? 'warn' : ''}>Violations: {viol}/3</small>
        </div>
      </div>
      {warn && <div className="card warn">{warn}</div>}
      {!isFs && document.fullscreenEnabled && (
        <div className="card"><button onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>Fullscreen mode on karo</button></div>
      )}

      <div className="card">
        <p><b>Q{idx + 1}/{qn.length}.</b> {cur.text}</p>
        {['a', 'b', 'c', 'd'].map(k => (
          <div key={k} className={'opt ' + (answers[cur.id] === k ? 'sel' : '')} onClick={() => pick(cur.id, k)}>
            <b>{k.toUpperCase()}.</b> {cur[k]}
          </div>
        ))}
        <button className="sec" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Prev</button>
        <button className="sec" disabled={idx === qn.length - 1} onClick={() => setIdx(idx + 1)}>Next →</button>
      </div>

      <div className="card">
        {qn.map((x, i) => (
          <button key={x.id} className={answers[x.id] ? '' : 'sec'} style={{ minWidth: 40, outline: i === idx ? '2px solid #111' : 'none' }} onClick={() => setIdx(i)}>{i + 1}</button>
        ))}
      </div>

      <div className="card">
        {subErr && <p className="warn">Submit nahi hua: {subErr}</p>}
        {!confirming
          ? <button className="red" onClick={() => setConfirming(true)}>{subErr ? 'Retry Submit' : 'Submit Exam'}</button>
          : <>
              <p>Pakka submit karna hai? ({Object.keys(answers).length}/{qn.length} answered)</p>
              <button className="red" onClick={() => { setConfirming(false); submit(); }}>Haan, Submit</button>
              <button className="sec" onClick={() => setConfirming(false)}>Cancel</button>
            </>}
      </div>
    </div>
  );
}

/* ---------------- Root ---------------- */
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } });
  const [view, setView] = useState('home'), [examId, setExamId] = useState(null);

  const login = (t, u) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); setToken(t); setUser(u); setView('home'); };
  const logout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); setToken(null); setUser(null); setView('home'); };
  const start = id => {
    // Fullscreen user click ke andar hi request hona chahiye
    document.documentElement.requestFullscreen?.().catch(() => {});
    setExamId(id); setView('exam');
  };
  const home = () => { exitFs(); setView('home'); };

  return (
    <div className="wrap">
      <h1 style={{ fontSize: 22 }}>📝 Online Exam Portal</h1>
      {!token || !user ? <Auth onLogin={login}
        /> : view === 'exam' ? <Exam token={token} examId={examId} onExit={home}
        /> : view === 'create' ? <CreateExam token={token} onBack={() => setView('home')}
        /> : <Home token={token} user={user} onStart={start} onCreate={() => setView('create')} onLogout={logout} />}
    </div>
  );
}
