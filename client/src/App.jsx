import React,{useState,useEffect,useRef,useCallback} from 'react';
const API=(import.meta.env.VITE_API_URL||'http://localhost:5000')+'/api';
const MAX_VIOLATIONS=3;

async function api(path,method='GET',body){
  const token=localStorage.getItem('token');
  const r=await fetch(API+path,{method,headers:{'Content-Type':'application/json',...(token&&{Authorization:'Bearer '+token})},
    body:body?JSON.stringify(body):undefined});
  const d=await r.json(); if(!r.ok)throw new Error(d.error||'Error'); return d;
}

function Auth({onLogin}){
  const [mode,setMode]=useState('login'),[f,setF]=useState({name:'',email:'',password:'',role:'student'}),[err,setErr]=useState('');
  const set=k=>e=>setF({...f,[k]:e.target.value});
  const submit=async()=>{try{
    if(mode==='register'){await api('/register','POST',f);setMode('login');setErr('Registered! Now login.');return;}
    const d=await api('/login','POST',f);localStorage.setItem('token',d.token);localStorage.setItem('user',JSON.stringify(d.user));onLogin(d.user);
  }catch(e){setErr(e.message);}};
  return <div className="wrap"><div className="card"><h2>Online Exam Portal</h2>
    {mode==='register'&&<input placeholder="Name" onChange={set('name')}/>}
    <input placeholder="Email" onChange={set('email')}/>
    <input type="password" placeholder="Password" onChange={set('password')}/>
    <p style={{color:'#dc2626'}}>{err}</p>
    <button onClick={submit}>{mode==='login'?'Login':'Register'}</button>
    <button className="sec" onClick={()=>setMode(mode==='login'?'register':'login')}>{mode==='login'?'New user?':'Have account?'}</button>
  </div></div>;
}

function Exam({examId,onExit}){
  const [data,setData]=useState(null),[answers,setAnswers]=useState({}),[idx,setIdx]=useState(0);
  const [time,setTime]=useState(0),[viol,setViol]=useState(0),[result,setResult]=useState(null),[msg,setMsg]=useState('');
  const submitted=useRef(false),answersRef=useRef({}); answersRef.current=answers;

  const submit=useCallback(async()=>{
    if(submitted.current||!data)return; submitted.current=true;
    if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
    try{setResult(await api(`/attempts/${data.attemptId}/submit`,'POST',{answers:answersRef.current}));}
    catch(e){setMsg(e.message);}
  },[data]);

  useEffect(()=>{api(`/exams/${examId}/start`,'POST').then(d=>{setData(d);setTime(d.remaining);
    document.documentElement.requestFullscreen?.().catch(()=>{});}).catch(e=>setMsg(e.message));},[examId]);

  // Timer
  useEffect(()=>{if(!data||result)return;
    const t=setInterval(()=>setTime(s=>{if(s<=1){clearInterval(t);return 0;}return s-1;}),1000);return()=>clearInterval(t);},[data,result]);
  useEffect(()=>{if(data&&time===0&&!result)submit();},[time,data,result,submit]);

  // Anti-cheat: tab switch, fullscreen exit; block copy/paste/right-click
  useEffect(()=>{
    if(!data||result)return;
    const report=async why=>{
      if(submitted.current)return;
      try{const r=await api(`/attempts/${data.attemptId}/violation`,'POST');setViol(r.violations);
        setMsg(`Warning: ${why}. Violation ${r.violations}/${MAX_VIOLATIONS}`);
        if(r.violations>=MAX_VIOLATIONS)submit();}catch{}
    };
    const onVis=()=>{if(document.hidden)report('Tab switched');};
    const onFs=()=>{if(!document.fullscreenElement)report('Fullscreen exited');};
    const block=e=>e.preventDefault();
    document.addEventListener('visibilitychange',onVis);
    document.addEventListener('fullscreenchange',onFs);
    document.addEventListener('copy',block);document.addEventListener('paste',block);
    document.addEventListener('contextmenu',block);
    return()=>{document.removeEventListener('visibilitychange',onVis);document.removeEventListener('fullscreenchange',onFs);
      document.removeEventListener('copy',block);document.removeEventListener('paste',block);document.removeEventListener('contextmenu',block);};
  },[data,result,submit]);

  if(result)return <div className="wrap"><div className="card"><h2>{result.late?'Time over':'Exam Submitted'}</h2>
    <h1>{result.score} / {result.total}</h1>{result.late&&<p>Late submission: score 0.</p>}
    <button onClick={onExit}>Back to Dashboard</button></div></div>;
  if(!data)return <div className="wrap"><div className="card">{msg||'Loading...'}<br/>{msg&&<button onClick={onExit}>Back</button>}</div></div>;

  const q=data.questions[idx],m=String(Math.floor(time/60)).padStart(2,'0'),s=String(time%60).padStart(2,'0');
  return <div className="wrap nosel"><div className="card">
    <div className="top"><b>{data.title}</b><span className={'timer '+(time<60?'warn':'')}>{m}:{s}</span></div>
    <small>Violations: {viol}/{MAX_VIOLATIONS}</small>{msg&&<p className="warn">{msg}</p>}</div>
    <div className="card"><p><b>Q{idx+1}/{data.questions.length}.</b> {q.text}</p>
      {['a','b','c','d'].map(o=><label key={o} className={'opt '+(answers[q.id]===o?'sel':'')}>
        <input type="radio" style={{width:'auto',marginRight:8}} checked={answers[q.id]===o} onChange={()=>setAnswers({...answers,[q.id]:o})}/>{q[o]}</label>)}
      <button className="sec" disabled={idx===0} onClick={()=>setIdx(idx-1)}>Prev</button>
      <button disabled={idx===data.questions.length-1} onClick={()=>setIdx(idx+1)}>Next</button>
      <button className="red" onClick={()=>window.confirm('Submit exam?')&&submit()}>Submit</button>
    </div></div>;
}

function Admin({onBack}){
  const [title,setTitle]=useState(''),[dur,setDur]=useState(10),[msg,setMsg]=useState('');
  const blank={text:'',a:'',b:'',c:'',d:'',correct:'a'};
  const [qs,setQs]=useState([{...blank}]);
  const upd=(i,k,v)=>setQs(qs.map((q,j)=>j===i?{...q,[k]:v}:q));
  const save=async()=>{try{await api('/exams','POST',{title,duration_min:+dur,questions:qs});setMsg('Exam created!');}catch(e){setMsg(e.message);}};
  return <div className="wrap"><div className="card"><h3>Create Exam</h3>
    <input placeholder="Title" onChange={e=>setTitle(e.target.value)}/>
    <input type="number" placeholder="Duration (minutes)" value={dur} onChange={e=>setDur(e.target.value)}/></div>
    {qs.map((q,i)=><div className="card" key={i}><b>Question {i+1}</b>
      <textarea placeholder="Question" onChange={e=>upd(i,'text',e.target.value)}/>
      {['a','b','c','d'].map(o=><input key={o} placeholder={'Option '+o.toUpperCase()} onChange={e=>upd(i,o,e.target.value)}/>)}
      <select value={q.correct} onChange={e=>upd(i,'correct',e.target.value)}>{['a','b','c','d'].map(o=><option key={o} value={o}>Correct: {o.toUpperCase()}</option>)}</select></div>)}
    <button className="sec" onClick={()=>setQs([...qs,{...blank}])}>+ Add Question</button>
    <button onClick={save}>Save Exam</button><button className="sec" onClick={onBack}>Back</button><p>{msg}</p></div>;
}

function Dashboard({user,onLogout,onStart}){
  const [exams,setExams]=useState([]),[results,setResults]=useState([]),[admin,setAdmin]=useState(false);
  useEffect(()=>{api('/exams').then(setExams);api('/results').then(setResults);},[admin]);
  if(admin)return <Admin onBack={()=>setAdmin(false)}/>;
  return <div className="wrap"><div className="card top"><b>Hi, {user.name} ({user.role})</b><button className="sec" onClick={onLogout}>Logout</button></div>
    {user.role==='admin'&&<button onClick={()=>setAdmin(true)}>+ Create Exam</button>}
    <h3>Exams</h3>{exams.map(e=><div className="card top" key={e.id}><div><b>{e.title}</b><br/><small>{e.qcount} questions, {e.duration_min} min</small></div>
      {user.role==='student'&&(e.done?<span>Done</span>:<button onClick={()=>onStart(e.id)}>Start</button>)}</div>)}
    <h3>Results</h3><div className="card"><table><thead><tr><th>Exam</th>{user.role==='admin'&&<th>Student</th>}<th>Score</th><th>Violations</th></tr></thead>
      <tbody>{results.map(r=><tr key={r.id}><td>{r.title}</td>{user.role==='admin'&&<td>{r.name}</td>}<td>{r.score}/{r.total}</td><td>{r.violations}</td></tr>)}</tbody></table></div></div>;
}

export default function App(){
  const [user,setUser]=useState(()=>JSON.parse(localStorage.getItem('user')||'null')),[exam,setExam]=useState(null);
  const logout=()=>{localStorage.clear();setUser(null);};
  if(!user)return <Auth onLogin={setUser}/>;
  if(exam)return <Exam examId={exam} onExit={()=>setExam(null)}/>;
  return <Dashboard user={user} onLogout={logout} onStart={setExam}/>;
}
