require('dotenv').config();
const express=require('express'),cors=require('cors'),mysql=require('mysql2/promise');
const jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs');
const app=express(); app.use(cors({origin:process.env.CLIENT_URL||'*'})); app.use(express.json());
const db=mysql.createPool({host:process.env.DB_HOST,port:process.env.DB_PORT||3306,
  user:process.env.DB_USER,password:process.env.DB_PASS,database:process.env.DB_NAME,
  waitForConnections:true,
  ssl:process.env.DB_SSL==='true'?{minVersion:'TLSv1.2',rejectUnauthorized:true}:undefined});
const SECRET=process.env.JWT_SECRET||'secret';
const wrap=fn=>(req,res)=>fn(req,res).catch(e=>{console.error(e);res.status(500).json({error:'Server error'})});

const auth=(req,res,next)=>{
  try{req.user=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),SECRET);next();}
  catch{res.status(401).json({error:'Login required'});}
};
const adminOnly=(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'Admin only'});

app.post('/api/register',wrap(async(req,res)=>{
  const{name,email,password}=req.body;
  if(!name||!email||!password)return res.status(400).json({error:'All fields required'});
  const [ex]=await db.query('SELECT id FROM users WHERE email=?',[email]);
  if(ex.length)return res.status(400).json({error:'Email already used'});
  const hash=await bcrypt.hash(password,10);
  // Everyone registers as student. Make admin manually in DB:
  // UPDATE users SET role='admin' WHERE email='your@email.com';
  await db.query('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)',
    [name,email,hash,'student']);
  res.json({ok:true});
}));

app.post('/api/login',wrap(async(req,res)=>{
  const{email,password}=req.body;
  const [r]=await db.query('SELECT * FROM users WHERE email=?',[email]);
  if(!r.length||!(await bcrypt.compare(password,r[0].password)))
    return res.status(400).json({error:'Wrong email or password'});
  const u=r[0];
  const token=jwt.sign({id:u.id,role:u.role,name:u.name},SECRET,{expiresIn:'1d'});
  res.json({token,user:{id:u.id,name:u.name,role:u.role}});
}));

app.get('/api/exams',auth,wrap(async(req,res)=>{
  const [r]=await db.query(`SELECT e.*,(SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id) AS qcount,
    (SELECT COUNT(*) FROM attempts a WHERE a.exam_id=e.id AND a.user_id=? AND a.submitted_at IS NOT NULL) AS done
    FROM exams e`,[req.user.id]);
  res.json(r);
}));

// Start exam: creates attempt, returns questions WITHOUT correct answers + remaining time
app.post('/api/exams/:id/start',auth,wrap(async(req,res)=>{
  const eid=req.params.id;
  const [ex]=await db.query('SELECT * FROM exams WHERE id=?',[eid]);
  if(!ex.length)return res.status(404).json({error:'Exam not found'});
  const [done]=await db.query('SELECT id FROM attempts WHERE user_id=? AND exam_id=? AND submitted_at IS NOT NULL',[req.user.id,eid]);
  if(done.length)return res.status(400).json({error:'Exam already submitted'});
  let [att]=await db.query('SELECT * FROM attempts WHERE user_id=? AND exam_id=? AND submitted_at IS NULL',[req.user.id,eid]);
  let attemptId;
  if(att.length)attemptId=att[0].id;
  else{const [i]=await db.query('INSERT INTO attempts(user_id,exam_id) VALUES(?,?)',[req.user.id,eid]);attemptId=i.insertId;}
  const [[t]]=await db.query('SELECT TIMESTAMPDIFF(SECOND,started_at,NOW()) AS elapsed FROM attempts WHERE id=?',[attemptId]);
  const remaining=Math.max(0,ex[0].duration_min*60-t.elapsed);
  const [qs]=await db.query('SELECT id,text,a,b,c,d FROM questions WHERE exam_id=?',[eid]);
  res.json({attemptId,title:ex[0].title,remaining,questions:qs});
}));

app.post('/api/attempts/:id/violation',auth,wrap(async(req,res)=>{
  await db.query('UPDATE attempts SET violations=violations+1 WHERE id=? AND user_id=? AND submitted_at IS NULL',[req.params.id,req.user.id]);
  const [[a]]=await db.query('SELECT violations FROM attempts WHERE id=?',[req.params.id]);
  res.json({violations:a.violations});
}));

// Submit: server-side evaluation (10s grace for network delay)
app.post('/api/attempts/:id/submit',auth,wrap(async(req,res)=>{
  const [att]=await db.query('SELECT a.*,e.duration_min FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=? AND a.user_id=?',[req.params.id,req.user.id]);
  if(!att.length)return res.status(404).json({error:'Attempt not found'});
  if(att[0].submitted_at)return res.status(400).json({error:'Already submitted'});
  const answers=req.body.answers||{};
  const [qs]=await db.query('SELECT id,correct FROM questions WHERE exam_id=?',[att[0].exam_id]);
  const [[t]]=await db.query('SELECT TIMESTAMPDIFF(SECOND,started_at,NOW()) AS elapsed FROM attempts WHERE id=?',[att[0].id]);
  const late=t.elapsed>att[0].duration_min*60+10;
  let score=0; if(!late)qs.forEach(q=>{if(answers[q.id]===q.correct)score++;});
  await db.query('UPDATE attempts SET submitted_at=NOW(),score=?,total=? WHERE id=?',[score,qs.length,att[0].id]);
  res.json({score,total:qs.length,late});
}));

app.get('/api/results',auth,wrap(async(req,res)=>{
  const sql=req.user.role==='admin'
    ?`SELECT a.*,e.title,u.name FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.user_id WHERE a.submitted_at IS NOT NULL ORDER BY a.submitted_at DESC`
    :`SELECT a.*,e.title,u.name FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.user_id WHERE a.user_id=? AND a.submitted_at IS NOT NULL ORDER BY a.submitted_at DESC`;
  const [r]=await db.query(sql,[req.user.id]);
  res.json(r);
}));

// Admin: create exam with questions
app.post('/api/exams',auth,adminOnly,wrap(async(req,res)=>{
  const{title,duration_min,questions}=req.body;
  if(!title||!duration_min||!Array.isArray(questions)||!questions.length)return res.status(400).json({error:'Invalid data'});
  const [i]=await db.query('INSERT INTO exams(title,duration_min) VALUES(?,?)',[title,duration_min]);
  for(const q of questions)
    await db.query('INSERT INTO questions(exam_id,text,a,b,c,d,correct) VALUES(?,?,?,?,?,?,?)',[i.insertId,q.text,q.a,q.b,q.c,q.d,q.correct]);
  res.json({ok:true,id:i.insertId});
}));

app.listen(process.env.PORT||5000,()=>console.log('Server running'));