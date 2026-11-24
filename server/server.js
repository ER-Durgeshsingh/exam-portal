require('dotenv').config();
const express=require('express'),cors=require('cors'),{Pool}=require('pg');
const jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs');
const app=express(); app.use(cors({origin:process.env.CLIENT_URL||'*'})); app.use(express.json());
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const q=async(sql,params=[])=>(await pool.query(sql,params)).rows;
const SECRET=process.env.JWT_SECRET||'secret';
const wrap=fn=>(req,res)=>fn(req,res).catch(e=>{console.error(e);res.status(500).json({error:'Server error'})});

const auth=(req,res,next)=>{
  try{req.user=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),SECRET);next();}
  catch{res.status(401).json({error:'Login required'});}
};
const adminOnly=(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'Admin only'});
const ELAPSED='FLOOR(EXTRACT(EPOCH FROM (NOW()-started_at)))::int';

app.post('/api/register',wrap(async(req,res)=>{
  const{name,email,password}=req.body;
  if(!name||!email||!password)return res.status(400).json({error:'All fields required'});
  const ex=await q('SELECT id FROM users WHERE email=$1',[email]);
  if(ex.length)return res.status(400).json({error:'Email already used'});
  const hash=await bcrypt.hash(password,10);
  // Sab student banenge. Admin banane ke liye: UPDATE users SET role='admin' WHERE email='your@email.com';
  await q('INSERT INTO users(name,email,password,role) VALUES($1,$2,$3,$4)',[name,email,hash,'student']);
  res.json({ok:true});
}));

app.post('/api/login',wrap(async(req,res)=>{
  const{email,password}=req.body;
  const r=await q('SELECT * FROM users WHERE email=$1',[email]);
  if(!r.length||!(await bcrypt.compare(password,r[0].password)))
    return res.status(400).json({error:'Wrong email or password'});
  const u=r[0];
  const token=jwt.sign({id:u.id,role:u.role,name:u.name},SECRET,{expiresIn:'1d'});
  res.json({token,user:{id:u.id,name:u.name,role:u.role}});
}));

app.get('/api/exams',auth,wrap(async(req,res)=>{
  const r=await q(`SELECT e.*,(SELECT COUNT(*)::int FROM questions q WHERE q.exam_id=e.id) AS qcount,
    (SELECT COUNT(*)::int FROM attempts a WHERE a.exam_id=e.id AND a.user_id=$1 AND a.submitted_at IS NOT NULL) AS done
    FROM exams e ORDER BY e.id`,[req.user.id]);
  res.json(r);
}));

app.post('/api/exams/:id/start',auth,wrap(async(req,res)=>{
  const eid=req.params.id;
  const ex=await q('SELECT * FROM exams WHERE id=$1',[eid]);
  if(!ex.length)return res.status(404).json({error:'Exam not found'});
  const done=await q('SELECT id FROM attempts WHERE user_id=$1 AND exam_id=$2 AND submitted_at IS NOT NULL',[req.user.id,eid]);
  if(done.length)return res.status(400).json({error:'Exam already submitted'});
  let att=await q('SELECT * FROM attempts WHERE user_id=$1 AND exam_id=$2 AND submitted_at IS NULL',[req.user.id,eid]);
  let attemptId;
  if(att.length)attemptId=att[0].id;
  else attemptId=(await q('INSERT INTO attempts(user_id,exam_id) VALUES($1,$2) RETURNING id',[req.user.id,eid]))[0].id;
  const [t]=await q(`SELECT ${ELAPSED} AS elapsed FROM attempts WHERE id=$1`,[attemptId]);
  const remaining=Math.max(0,ex[0].duration_min*60-t.elapsed);
  const qs=await q('SELECT id,text,a,b,c,d FROM questions WHERE exam_id=$1 ORDER BY id',[eid]);
  res.json({attemptId,title:ex[0].title,remaining,questions:qs});
}));

app.post('/api/attempts/:id/violation',auth,wrap(async(req,res)=>{
  await q('UPDATE attempts SET violations=violations+1 WHERE id=$1 AND user_id=$2 AND submitted_at IS NULL',[req.params.id,req.user.id]);
  const [a]=await q('SELECT violations FROM attempts WHERE id=$1',[req.params.id]);
  res.json({violations:a.violations});
}));

app.post('/api/attempts/:id/submit',auth,wrap(async(req,res)=>{
  const att=await q('SELECT a.*,e.duration_min FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=$1 AND a.user_id=$2',[req.params.id,req.user.id]);
  if(!att.length)return res.status(404).json({error:'Attempt not found'});
  if(att[0].submitted_at)return res.status(400).json({error:'Already submitted'});
  const answers=req.body.answers||{};
  const qs=await q('SELECT id,correct FROM questions WHERE exam_id=$1',[att[0].exam_id]);
  const [t]=await q(`SELECT ${ELAPSED} AS elapsed FROM attempts WHERE id=$1`,[att[0].id]);
  const late=t.elapsed>att[0].duration_min*60+10;
  let score=0; if(!late)qs.forEach(x=>{if(answers[x.id]===x.correct)score++;});
  await q('UPDATE attempts SET submitted_at=NOW(),score=$1,total=$2 WHERE id=$3',[score,qs.length,att[0].id]);
  res.json({score,total:qs.length,late});
}));

app.get('/api/results',auth,wrap(async(req,res)=>{
  const base=`SELECT a.*,e.title,u.name FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.user_id WHERE a.submitted_at IS NOT NULL`;
  const r=req.user.role==='admin'
    ?await q(base+' ORDER BY a.submitted_at DESC')
    :await q(base+' AND a.user_id=$1 ORDER BY a.submitted_at DESC',[req.user.id]);
  res.json(r);
}));

app.post('/api/exams',auth,adminOnly,wrap(async(req,res)=>{
  const{title,duration_min,questions}=req.body;
  if(!title||!duration_min||!Array.isArray(questions)||!questions.length)return res.status(400).json({error:'Invalid data'});
  const id=(await q('INSERT INTO exams(title,duration_min) VALUES($1,$2) RETURNING id',[title,duration_min]))[0].id;
  for(const x of questions)
    await q('INSERT INTO questions(exam_id,text,a,b,c,d,correct) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,x.text,x.a,x.b,x.c,x.d,x.correct]);
  res.json({ok:true,id});
}));

app.listen(process.env.PORT||5000,()=>console.log('Server running'));
