import { secretDraw, randomInt } from './draw.js';

const EXPECTED_COUNT = 8; // Quantidade de participantes, sem guardar nomes no código.
const EVENT_TITLE = 'Amigo Oculto da Família · Natal 2026';
const EVENT_DATE = '2026-11-25';
const encoder = new TextEncoder();
const ID_PATTERN = /^[A-Za-z0-9_-]{16,60}$/;
const SECURE_HEADERS = {
  'Cache-Control':'no-store, private',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"
};

function json(value, status=200, origin='') {
  const headers = { 'Content-Type':'application/json; charset=utf-8', ...SECURE_HEADERS, Vary:'Origin' };
  if(origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(value),{status,headers});
}
class UserError extends Error {
  constructor(message, status=400){super(message);this.status=status;}
}
function assert(condition,message,status=400){if(!condition)throw new UserError(message,status);}
function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function randomToken(size=18){const bytes=new Uint8Array(size);crypto.getRandomValues(bytes);return base64url(bytes);}
function base64(bytes){return btoa(String.fromCharCode(...bytes));}
function unbase64(str){return Uint8Array.from(atob(str),x=>x.charCodeAt(0));}
function htmlEscape(input){return String(input).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function sha256(input){const digest=await crypto.subtle.digest('SHA-256',encoder.encode(input));return base64url(new Uint8Array(digest));}
async function secureEqual(a,b){
  const [ha,hb]=await Promise.all([sha256(a),sha256(b)]);
  let difference=ha.length^hb.length;
  for(let i=0;i<Math.min(ha.length,hb.length);i++)difference |= ha.charCodeAt(i)^hb.charCodeAt(i);
  return difference===0;
}
async function readBody(request){
  const type=request.headers.get('Content-Type')||'';
  assert(type.toLowerCase().includes('application/json'),'Envie dados em JSON.',415);
  const length=Number(request.headers.get('Content-Length')||'0');
  assert(length<=5000,'Dados muito grandes.',413);
  const text=await request.text();assert(text.length<=5000,'Dados muito grandes.',413);
  try{const parsed=JSON.parse(text);assert(parsed && typeof parsed==='object' && !Array.isArray(parsed),'Dados inválidos.');return parsed;}
  catch(error){if(error instanceof UserError)throw error;throw new UserError('Dados inválidos.');}
}
function cleanEmail(value){
  assert(typeof value==='string','E-mail inválido.');
  const email=value.trim().toLowerCase();
  assert(email.length>4&&email.length<=254&&/^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/.test(email),'Informe um e-mail válido.');
  return email;
}
function requireID(id){assert(typeof id==='string'&&ID_PATTERN.test(id),'Convite inválido.');return id;}
function requireName(value){
  assert(typeof value==='string','Informe seu nome.');
  const name=value.normalize('NFC').trim().replace(/\s+/g,' ');
  assert(name.length>=2 && name.length<=60 && !/[<>\u0000-\u001f\u007f]/.test(name),'Informe um nome entre 2 e 60 caracteres.');
  return name;
}
function nameKey(name){return name.toLocaleLowerCase('pt-BR');}
function requireSecrets(env){
  if(!env.DB||!env.HOST_SETUP_CODE||!env.RESEND_API_KEY||!env.OTP_PEPPER||!env.DRAW_KEY||!env.FROM_EMAIL||!env.FRONTEND_ORIGIN) throw Error('Configuração privada incompleta.');
}
async function rateLimit(env,request,action,limit,windowSeconds){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const now=Math.floor(Date.now()/1000);
  const window=Math.floor(now/windowSeconds);
  const key=`${action}:${window}:${(await sha256(`${env.OTP_PEPPER}:${ip}`)).slice(0,24)}`;
  const row=await env.DB.prepare(`INSERT INTO rate_limits(bucket,hits,expires_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits`).bind(key,(window+1)*windowSeconds).first();
  assert(row.hits<=limit,'Muitas tentativas. Aguarde um pouco e tente novamente.',429);
}
function allowedOrigin(request,env){
  const origin=request.headers.get('Origin')||'';
  const allowed=env.FRONTEND_ORIGIN?.replace(/\/$/,'')||'';
  return origin===allowed ? allowed : '';
}
function checkPostOrigin(request,env){
  const origin=request.headers.get('Origin');
  // Origin é controle de navegador (CORS), não autenticação; autorizações continuam no servidor.
  assert(!origin || origin===env.FRONTEND_ORIGIN?.replace(/\/$/,''),'Origem não autorizada.',403);
}
function makeHtmlShell(preheader,body){
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4efe6;color:#153f34;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${htmlEscape(preheader)}</div><table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:36px 12px"><table role="presentation" width="100%" style="max-width:520px;background:#fffdf7;border:1px solid #e3d9c9;border-collapse:separate;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:22px;background:#153f34;color:#e9d5ae;font-size:24px;font-family:Georgia,serif">✳ &nbsp; entre <i>nós.</i></td></tr><tr><td style="padding:36px 38px 28px">${body}</td></tr><tr><td align="center" style="padding:20px;color:#657c6c;background:#f7f3e9;font-size:11px">UMA TRADIÇÃO DA NOSSA FAMÍLIA · NATAL 2026</td></tr></table></td></tr></table></body></html>`;
}
async function sendEmail(env,{to,subject,html,text,key}){
  const result=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},
    body:JSON.stringify({from:env.FROM_EMAIL,to:[to],subject,html,text})
  });
  if(!result.ok){
    // Não registrar corpos, destinatários, chaves ou resultados em logs.
    throw new Error(`Falha do serviço de e-mail: HTTP ${result.status}`);
  }
  return true;
}
async function sendVerification(env,email,code,name,challenge){
  const safeName=htmlEscape(name);
  const html=makeHtmlShell('Seu código de confirmação do amigo oculto',`
    <p style="font-size:11px;font-weight:bold;letter-spacing:2px;color:#ac4139">CONFIRMAÇÃO DE PRESENÇA</p>
    <h1 style="font:normal 34px Georgia,serif;line-height:1.2;margin:18px 0">Seu lugar está quase garantido.</h1>
    <p style="font-size:15px;line-height:1.7;color:#526757">Olá, <strong>${safeName}</strong>! Digite este código no site para confirmar seu e-mail no nosso amigo oculto:</p>
    <p style="background:#f3efe4;border:1px solid #d6c8ad;border-radius:9px;font-size:34px;letter-spacing:9px;text-align:center;font-weight:bold;padding:20px 10px;color:#153f34">${code}</p>
    <p style="font-size:13px;color:#718072;line-height:1.6">O código expira em 15 minutos. Se você não pediu este e-mail, ignore-o.</p>`);
  await sendEmail(env,{to:email,subject:'✳ Seu código · Amigo Oculto 2026',html,text:`Olá, ${name}! Seu código de confirmação é ${code}. Válido por 15 minutos.`,key:`otp-${challenge}`});
}
async function sendAssignment(env,email,giver,recipient,eventId){
  const html=makeHtmlShell('O segredo do seu amigo oculto chegou!',`
    <p style="font-size:11px;font-weight:bold;letter-spacing:2px;color:#ac4139">UMA SURPRESA SÓ SUA</p>
    <h1 style="font:normal 38px Georgia,serif;margin:18px 0 10px;line-height:1.16">O segredo chegou, ${htmlEscape(giver)}.</h1>
    <p style="font-size:15px;color:#536c5b;line-height:1.7">O nosso sorteio de Natal aconteceu. Neste ano, você vai preparar um presente para...</p>
    <div style="text-align:center;border:1px solid #decaa9;background:#f9f2e6;border-radius:10px;padding:33px 14px;margin:23px 0"><div style="font-size:24px;color:#ad8d57">✳</div><p style="font:normal 12px Arial,sans-serif;letter-spacing:2px;color:#a07856">SEU AMIGO OCULTO É</p><div style="font:normal 36px Georgia,serif;color:#a43e36;line-height:1.2">${htmlEscape(recipient)}</div></div>
    <p style="font-size:15px;color:#536c5b;line-height:1.7">Guarde com carinho e não conte para ninguém! <strong>25 de novembro de 2026</strong> é a data que marcamos para a nossa tradição.</p>
    <p style="font-size:13px;color:#718072">Este e-mail é individual. Nenhum outro participante recebe o seu resultado.</p>`);
  await sendEmail(env,{to:email,subject:'🎄 Seu amigo oculto de 2026 foi revelado!',html,text:`Olá, ${giver}! Seu amigo oculto é: ${recipient}. Guarde segredo! 25/11/2026.`,key:`draw-${eventId}-${(await sha256(giver)).slice(0,32)}`});
}
async function makeKey(env){
  const bytes=unbase64(env.DRAW_KEY.trim());
  if(bytes.length!==32)throw Error('DRAW_KEY deve conter 32 bytes em Base64.');
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function encryptName(key,eventId,giver,recipient){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`${eventId}|${giver}`)},key,encoder.encode(recipient));
  return {cipher:base64(new Uint8Array(ciphertext)),nonce:base64(iv)};
}
async function decryptName(key,eventId,giver,cipher,nonce){
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(nonce),additionalData:encoder.encode(`${eventId}|${giver}`)},key,unbase64(cipher));
  return new TextDecoder().decode(plain);
}
async function createEvent(request,env){
  await rateLimit(env,request,'create',5,3600);
  const {setupCode}=await readBody(request);
  assert(typeof setupCode==='string'&&setupCode.length<=256,'Código inválido.',403);
  assert(await secureEqual(setupCode,env.HOST_SETUP_CODE),'Código de criação incorreto.',403);
  // Um único evento por implantação impede duplicar o sorteio por engano.
  const existing=await env.DB.prepare('SELECT id FROM events ORDER BY created_at LIMIT 1').first();
  if(existing)return {id:existing.id};
  const id=randomToken(24),now=Math.floor(Date.now()/1000);
  try {
    await env.DB.prepare('INSERT INTO events(id,title,event_date,status,created_at) VALUES(?,?,?,?,?)').bind(id,EVENT_TITLE,EVENT_DATE,'open',now).run();
    return {id};
  } catch(error) {
    // Em criações simultâneas, a restrição UNIQUE assegura uma sala só.
    const created=await env.DB.prepare('SELECT id FROM events WHERE title=? LIMIT 1').bind(EVENT_TITLE).first();
    if(created)return {id:created.id};
    throw error;
  }
}
async function readEvent(env,id){
  requireID(id);
  const row=await env.DB.prepare('SELECT id,title,event_date,status FROM events WHERE id=?').bind(id).first();
  assert(row,'Convite não encontrado.',404);
  // Só agregados; NUNCA retornar nomes, e-mails ou associações ao frontend.
  let verifiedCount=EXPECTED_COUNT, sentCount=EXPECTED_COUNT;
  if(row.status!=='complete'){
    const aggregate=await env.DB.prepare('SELECT COUNT(*) AS total FROM participants WHERE event_id=? AND verified=1').bind(id).first();
    const sent=await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE event_id=? AND state='sent'").bind(id).first();
    verifiedCount=aggregate?.total||0;
    sentCount=sent?.total||0;
  }
  return {id,title:row.title,eventDate:row.event_date,status:row.status,verifiedCount,total:EXPECTED_COUNT,sentCount};
}
async function register(request,env){
  await rateLimit(env,request,'register',25,3600);
  const {eventId,name:rawName,email:rawEmail}=await readBody(request);
  requireID(eventId);
  const name=requireName(rawName), key=nameKey(name), email=cleanEmail(rawEmail);
  const event=await env.DB.prepare('SELECT status FROM events WHERE id=?').bind(eventId).first();
  assert(event,'Convite não encontrado.',404);
  assert(event.status==='open','As inscrições deste sorteio já foram encerradas.',409);
  const verified=await env.DB.prepare('SELECT COUNT(*) AS total FROM participants WHERE event_id=? AND verified=1').bind(eventId).first();
  assert(verified.total<EXPECTED_COUNT,'O grupo já está completo.',409);
  const alreadyVerified=await env.DB.prepare('SELECT 1 AS found FROM participants WHERE event_id=? AND email=? AND verified=1 LIMIT 1').bind(eventId,email).first();
  assert(!alreadyVerified,'Este e-mail já está confirmado no sorteio.',409);
  const now=Math.floor(Date.now()/1000);
  const code=String(randomInt(1000000)).padStart(6,'0');
  const token=randomToken(24);
  const hash=await sha256(`${env.OTP_PEPPER}|${eventId}|${name}|${token}|${code}`);
  // Inscrição apenas no banco privado; os nomes nunca aparecem na versão pública.
  // ON CONFLICT preserva a verificação existente e impede substituições durante o cooldown.
  const result=await env.DB.prepare(`INSERT INTO participants
    (event_id,name,name_key,email,verified,code_hash,challenge_token,code_expires_at,code_attempts,last_code_sent_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE id=? AND status='open')
    ON CONFLICT(event_id,name_key) DO UPDATE SET
      name=excluded.name,email=excluded.email,code_hash=excluded.code_hash,challenge_token=excluded.challenge_token,
      code_expires_at=excluded.code_expires_at,code_attempts=0,last_code_sent_at=excluded.last_code_sent_at
      WHERE participants.verified=0 AND (participants.code_expires_at IS NULL OR
      participants.code_expires_at<=? OR (participants.email=? AND COALESCE(participants.last_code_sent_at,0)<=?))
    RETURNING name`).bind(eventId,name,key,email,0,hash,token,now+900,0,now,eventId,now,email,now-60).first();
  assert(result,'Este nome já está confirmado ou recebeu um código recente. Confira o e-mail ou aguarde 15 minutos.',409);
  try{await sendVerification(env,email,code,name,token);}
  catch(error){
    await env.DB.prepare(`DELETE FROM participants WHERE event_id=? AND name_key=? AND challenge_token=? AND verified=0`).bind(eventId,key,token).run();
    throw new UserError('Não foi possível enviar o e-mail. Confira a configuração de envio ou tente novamente.',503);
  }
  return {challengeToken:token,expiresIn:900};
}
async function resetParticipant(request,env){
  await rateLimit(env,request,'reset',12,3600);
  const {eventId,name:rawName,setupCode}=await readBody(request);
  requireID(eventId);
  const name=requireName(rawName);
  assert(typeof setupCode==='string' && setupCode.length<=256,'Código de organização inválido.',403);
  assert(await secureEqual(setupCode,env.HOST_SETUP_CODE),'Código de organização incorreto.',403);
  // A pessoa informa seu nome ao organizador; não precisamos publicar a lista.
  const deleted=await env.DB.prepare(`DELETE FROM participants
    WHERE event_id=? AND name_key=? AND EXISTS
      (SELECT 1 FROM events WHERE id=? AND status='open') RETURNING name`)
    .bind(eventId,nameKey(name),eventId).first();
  assert(deleted,'Cadastro não encontrado ou sorteio já iniciado.',409);
  return {reset:true};
}
async function verify(request,env,ctx){
  await rateLimit(env,request,'verify',50,900);
  const {eventId,name:rawName,challengeToken,code}=await readBody(request);
  requireID(eventId);const name=requireName(rawName);
  assert(typeof challengeToken==='string'&&ID_PATTERN.test(challengeToken),'Confirmação inválida.');
  assert(typeof code==='string'&&/^\d{6}$/.test(code),'O código deve ter 6 números.');
  const row=await env.DB.prepare('SELECT name,verified,email,challenge_token,code_expires_at,code_attempts,code_hash FROM participants WHERE event_id=? AND name_key=?').bind(eventId,nameKey(name)).first();
  assert(row,'Participante não encontrado.',404);
  assert(!row.verified,'Esse nome já foi confirmado.',409);
  const now=Math.floor(Date.now()/1000);
  assert(row.challenge_token===challengeToken && row.code_expires_at>=now,'Código inválido ou expirado. Solicite um novo código.',400);
  assert(row.code_attempts<5,'Muitas tentativas. Espere o código expirar e solicite outro.',429);
  const hash=await sha256(`${env.OTP_PEPPER}|${eventId}|${row.name}|${challengeToken}|${code}`);
  if(!await secureEqual(hash,row.code_hash||'')){
    await env.DB.prepare('UPDATE participants SET code_attempts=code_attempts+1 WHERE event_id=? AND name=? AND challenge_token=? AND verified=0').bind(eventId,row.name,challengeToken).run();
    throw new UserError('Código incorreto. Confira os seis números.',400);
  }
  // Um e-mail verificado só pode ocupar um nome neste evento.
  const emailInUse=await env.DB.prepare('SELECT name FROM participants WHERE event_id=? AND email=? AND verified=1 LIMIT 1').bind(eventId,row.email).first();
  assert(!emailInUse,'Este e-mail já foi confirmado em outro nome.',409);
  const updated=await env.DB.prepare(`UPDATE participants SET verified=1,verified_at=?,code_hash=NULL,challenge_token=NULL,code_expires_at=NULL
    WHERE event_id=? AND name=? AND verified=0 AND challenge_token=? AND code_hash=? AND code_attempts<5
      AND EXISTS(SELECT 1 FROM events WHERE id=? AND status='open')
      AND (SELECT COUNT(*) FROM participants WHERE event_id=? AND verified=1) < ?
    RETURNING name`).bind(now,eventId,row.name,challengeToken,hash,eventId,eventId,EXPECTED_COUNT).first();
  assert(updated,'Este código não está mais válido.',409);
  // O usuário não precisa aguardar a entrega de oito e-mails nesta chamada.
  ctx.waitUntil(advanceEvent(env,eventId).catch(()=>{}));
  return {verified:true};
}
async function ensureDraw(env,eventId){
  const event=await env.DB.prepare('SELECT status FROM events WHERE id=?').bind(eventId).first();
  if(!event||event.status!=='open')return;
  const people=await env.DB.prepare('SELECT name FROM participants WHERE event_id=? AND verified=1 ORDER BY name_key').bind(eventId).all();
  if(people.results.length!==EXPECTED_COUNT)return;
  const names=people.results.map(p=>p.name);
  const pairs=secretDraw(names);
  const key=await makeKey(env);
  const encrypted=await Promise.all(pairs.map(async p=>({giver:p.giver,...await encryptName(key,eventId,p.giver,p.recipient)})));
  const now=Math.floor(Date.now()/1000);
  await env.DB.batch([
    env.DB.prepare(`UPDATE events SET status='sending',drawn_at=? WHERE id=? AND status='open' AND
      (SELECT COUNT(*) FROM participants WHERE event_id=? AND verified=1)=?`).bind(now,eventId,eventId,EXPECTED_COUNT),
    ...encrypted.map(p=>env.DB.prepare(`INSERT OR IGNORE INTO outbox(event_id,giver,encrypted_recipient,nonce)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE id=? AND status='sending')`)
      .bind(eventId,p.giver,p.cipher,p.nonce,eventId))
  ]);
}
async function dispatchEvent(env,eventId){
  const event=await env.DB.prepare('SELECT status FROM events WHERE id=?').bind(eventId).first();
  if(!event||event.status!=='sending')return;
  const rows=await env.DB.prepare(`SELECT o.giver,o.encrypted_recipient,o.nonce,p.email
    FROM outbox o JOIN participants p ON p.event_id=o.event_id AND p.name=o.giver
    WHERE o.event_id=? AND o.state='pending' AND o.lease_until<=? ORDER BY o.giver LIMIT 8`)
    .bind(eventId,Math.floor(Date.now()/1000)).all();
  if(rows.results.length===0){await finishIfComplete(env,eventId);return;}
  const key=await makeKey(env);
  for(let i=0;i<rows.results.length;i++){
    const row=rows.results[i];
    const now=Math.floor(Date.now()/1000);
    const lease=await env.DB.prepare(`UPDATE outbox SET lease_until=?,attempts=attempts+1
      WHERE event_id=? AND giver=? AND state='pending' AND lease_until<=? RETURNING giver`)
      .bind(now+120,eventId,row.giver,now).first();
    if(!lease)continue;
    try{
      const recipient=await decryptName(key,eventId,row.giver,row.encrypted_recipient,row.nonce);
      await sendAssignment(env,row.email,row.giver,recipient,eventId);
      // Apaga o mapeamento persistido após o provedor aceitar o e-mail.
      await env.DB.prepare(`UPDATE outbox SET state='sent',sent_at=?,encrypted_recipient=NULL,nonce=NULL,lease_until=0
        WHERE event_id=? AND giver=? AND state='pending'`).bind(Math.floor(Date.now()/1000),eventId,row.giver).run();
    }catch(error){
      // Mantém a atribuição cifrada para retry. Nunca gera outro sorteio.
      await env.DB.prepare('UPDATE outbox SET lease_until=? WHERE event_id=? AND giver=? AND state=\'pending\'').bind(Math.floor(Date.now()/1000)+40,eventId,row.giver).run();
    }
    // Evita exceder o limite usual de envio por segundo do provedor.
    if(i<rows.results.length-1) await new Promise(resolve=>setTimeout(resolve,650));
  }
  await finishIfComplete(env,eventId);
}
async function finishIfComplete(env,eventId){
  const result=await env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN state='sent' THEN 1 ELSE 0 END) AS sent
    FROM outbox WHERE event_id=?`).bind(eventId).first();
  if(result?.total===EXPECTED_COUNT&&result?.sent===EXPECTED_COUNT){
    // Envio aceito: apagar automaticamente os e-mails e nomes guardados no banco.
    // O status agregado permanece no evento; os pares já foram apagados individualmente.
    await env.DB.batch([
      env.DB.prepare(`UPDATE events SET status='complete',completed_at=? WHERE id=? AND status='sending'`)
        .bind(Math.floor(Date.now()/1000),eventId),
      env.DB.prepare('DELETE FROM outbox WHERE event_id=?').bind(eventId),
      env.DB.prepare('DELETE FROM participants WHERE event_id=?').bind(eventId)
    ]);
  }
}
async function advanceEvent(env,eventId){await ensureDraw(env,eventId);await dispatchEvent(env,eventId);}
async function runScheduled(env){
  const now=Math.floor(Date.now()/1000);
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now-86400).run();
  await env.DB.prepare(`DELETE FROM participants WHERE verified=0 AND code_expires_at<? AND
    EXISTS(SELECT 1 FROM events WHERE events.id=participants.event_id AND status='open')`).bind(now-86400).run();
  const active=await env.DB.prepare("SELECT id FROM events WHERE status IN ('open','sending') LIMIT 20").all();
  for(const event of active.results){
    try{await advanceEvent(env,event.id);}catch{ /* tenta no próximo agendamento */ }
  }
}
export default {
  async fetch(request,env,ctx){
    const origin=allowedOrigin(request,env);
    if(request.method==='OPTIONS'){
      if(!origin)return json({error:'Origem não autorizada.'},403);
      return new Response(null,{status:204,headers:{
        'Access-Control-Allow-Origin':origin,
        'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type',
        'Access-Control-Max-Age':'86400',Vary:'Origin',...SECURE_HEADERS
      }});
    }
    try{
      requireSecrets(env);
      const url=new URL(request.url);
      const path=url.pathname;
      if(request.method==='GET'&&path==='/api/health')return json({ok:true},200,origin);
      if(request.method==='GET'&&path.startsWith('/api/events/')){
        const id=decodeURIComponent(path.substring('/api/events/'.length));
        return json(await readEvent(env,id),200,origin);
      }
      if(request.method==='POST')checkPostOrigin(request,env);
      if(request.method==='POST'&&path==='/api/events')return json(await createEvent(request,env),201,origin);
      if(request.method==='POST'&&path==='/api/register')return json(await register(request,env),200,origin);
      if(request.method==='POST'&&path==='/api/reset')return json(await resetParticipant(request,env),200,origin);
      if(request.method==='POST'&&path==='/api/verify')return json(await verify(request,env,ctx),200,origin);
      return json({error:'Página não encontrada.'},404,origin);
    }catch(error){
      if(error instanceof UserError)return json({error:error.message},error.status,origin);
      // Não faça console.log de erro: provedores podem registrar detalhes da chamada.
      return json({error:'Erro interno. Tente novamente ou consulte quem configurou o servidor.'},500,origin);
    }
  },
  async scheduled(controller,env,ctx){ctx.waitUntil(runScheduled(env));}
};
