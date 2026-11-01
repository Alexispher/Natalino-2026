import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const ROOT = new URL('../', import.meta.url);
const NAMES = Array.from({length:8},(_,i)=>`Pessoa ${i+1}`);

function dbAdapter() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(readFileSync(new URL('migrations/0001_init.sql', ROOT),'utf8'));
  // Emula os métodos D1 necessários para verificar o fluxo integral com SQLite real.
  const wrap = (query, params=[]) => ({
    bind(...args){return wrap(query,args);},
    async first(){return sqlite.prepare(query).get(...params) ?? null;},
    async all(){return {results:sqlite.prepare(query).all(...params)};},
    async run(){return {meta:sqlite.prepare(query).run(...params)};},
    exec(){return sqlite.prepare(query).run(...params);}
  });
  return {
    sqlite,
    d1: {
      prepare(query){return wrap(query);},
      async batch(statements){
        sqlite.exec('BEGIN');
        try {
          const results=[];
          for(const item of statements) {
            const queryResult = await item.run();
            results.push(queryResult);
          }
          sqlite.exec('COMMIT');
          return results;
        } catch(error){sqlite.exec('ROLLBACK');throw error;}
      }
    }
  };
}

function ctx() {
  const pending=[];
  return {
    waitUntil(promise){pending.push(promise);},
    async drain(){while(pending.length) await Promise.all(pending.splice(0));}
  };
}

function request(path,method='GET',body){
  return new Request(`https://example.workers.dev${path}`,{
    method,
    headers:{'Origin':'https://familia.github.io',...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
}

async function jsonResponse(result){
  const body=await result.json();
  assert.equal(result.headers.get('Cache-Control'),'no-store, private');
  return {status:result.status,...body};
}

test('fluxo real: convite, 8 confirmações, sorteio privado, retry do e-mail e resultados apagados', {timeout:30000}, async (t)=>{
  const {sqlite,d1}=dbAdapter();
  t.after(()=>sqlite.close());
  const env={
    DB:d1,
    FRONTEND_ORIGIN:'https://familia.github.io',
    FROM_EMAIL:'Entre Nós <natal@exemplo.com>',
    HOST_SETUP_CODE:'uma-senha-unica-forte-123',
    OTP_PEPPER:randomBytes(32).toString('base64url'),
    DRAW_KEY:randomBytes(32).toString('base64'),
    RESEND_API_KEY:'teste-nao-real'
  };
  const messages=[];
  let firstAssignmentFailure=true;
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async (url,options)=>{
    assert.equal(url,'https://api.resend.com/emails');
    assert.equal(options.headers.Authorization,'Bearer teste-nao-real');
    const payload=JSON.parse(options.body);
    assert.equal(payload.to.length,1,'cada e-mail deve ter somente um destinatário');
    assert.equal(typeof options.headers['Idempotency-Key'],'string');
    const msg={...payload,idempotencyKey:options.headers['Idempotency-Key']};
    messages.push(msg);
    if(msg.subject.includes('foi revelado') && firstAssignmentFailure){
      firstAssignmentFailure=false;
      return new Response('temporariamente indisponível',{status:503});
    }
    return new Response(JSON.stringify({id:'test-email-id'}),{status:200});
  };
  t.after(()=>{globalThis.fetch=oldFetch;});

  const session=ctx();
  const bad=await jsonResponse(await worker.fetch(request('/api/events','POST',{setupCode:'errado'}),env,session));
  assert.equal(bad.status,403);
  const event=await jsonResponse(await worker.fetch(request('/api/events','POST',{setupCode:env.HOST_SETUP_CODE}),env,session));
  assert.equal(event.status,201);
  assert.match(event.id,/^[A-Za-z0-9_-]{32}$/);
  const createdAgain=await jsonResponse(await worker.fetch(request('/api/events','POST',{setupCode:env.HOST_SETUP_CODE}),env,session));
  assert.equal(createdAgain.id,event.id,'mesmo código não cria um segundo sorteio');

  for(let i=0;i<NAMES.length;i++){
    const name=NAMES[i];
    const email=`pessoa${i}@example.org`;
    const registered=await jsonResponse(await worker.fetch(request('/api/register','POST',{eventId:event.id,name,email}),env,session));
    assert.equal(registered.status,200);
    assert.ok(registered.challengeToken);
    const verification=messages.at(-1);
    assert.equal(verification.to[0],email);
    const code=verification.text.match(/\b\d{6}\b/)[0];
    const invalid=await jsonResponse(await worker.fetch(request('/api/verify','POST',{eventId:event.id,name,challengeToken:registered.challengeToken,code:'999999'===code?'888888':'999999'}),env,session));
    assert.equal(invalid.status,400,'código errado deve falhar');
    const verified=await jsonResponse(await worker.fetch(request('/api/verify','POST',{eventId:event.id,name,challengeToken:registered.challengeToken,code}),env,session));
    assert.equal(verified.status,200);
    await session.drain();
    if(i===0){
      const wrongReset=await jsonResponse(await worker.fetch(request('/api/reset','POST',{
        eventId:event.id,name,setupCode:'codigo-invalido'}),env,session));
      assert.equal(wrongReset.status,403,'qualquer familiar não pode apagar uma inscrição');
      const reset=await jsonResponse(await worker.fetch(request('/api/reset','POST',{
        eventId:event.id,name,setupCode:env.HOST_SETUP_CODE}),env,session));
      assert.equal(reset.status,200);
      const afterReset=await jsonResponse(await worker.fetch(request(`/api/events/${event.id}`),env,session));
      assert.equal(afterReset.verifiedCount,0,'organizador consegue corrigir um cadastro antes do sorteio');
      const newSignup=await jsonResponse(await worker.fetch(request('/api/register','POST',{
        eventId:event.id,name,email}),env,session));
      assert.equal(newSignup.status,200);
      const newCode=messages.at(-1).text.match(/\b\d{6}\b/)[0];
      const newVerify=await jsonResponse(await worker.fetch(request('/api/verify','POST',{
        eventId:event.id,name,challengeToken:newSignup.challengeToken,code:newCode}),env,session));
      assert.equal(newVerify.status,200);
      await session.drain();
    }
    const progress=await jsonResponse(await worker.fetch(request(`/api/events/${event.id}`),env,session));
    assert.equal(progress.verifiedCount,i+1);
    assert.ok(!JSON.stringify(progress).includes(email),'e-mails nunca devem aparecer no GET público');
    assert.ok(!JSON.stringify(progress).includes(name),'nomes nunca devem aparecer no GET público');
    assert.ok(!('participants' in progress),'status público não inclui lista de pessoas');
  }
  const sent=messages.filter(m=>m.subject.includes('foi revelado'));
  assert.equal(sent.length,8,'sistema tenta enviar uma vez para cada participante');
  const pending=sqlite.prepare("SELECT * FROM outbox WHERE state='pending'").all();
  assert.equal(pending.length,1,'falha deixa o par encriptado aguardando retry');
  assert.ok(pending[0].encrypted_recipient && pending[0].nonce);
  assert.ok(!NAMES.includes(pending[0].encrypted_recipient));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM outbox WHERE state='sent'").get().n,7);
  assert.equal(sqlite.prepare("SELECT status FROM events").get().status,'sending');
  sqlite.exec("UPDATE outbox SET lease_until=0 WHERE state='pending'");
  await worker.scheduled(null,env,session);
  await session.drain();
  assert.equal(sqlite.prepare("SELECT status FROM events").get().status,'complete');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM outbox").get().n,0,'pares enviados devem ser apagados após o aceite');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM participants").get().n,0,'nomes e e-mails são eliminados após o sorteio');
  const accepted=messages.filter(m=>m.subject.includes('foi revelado')).slice(1);
  assert.equal(accepted.length,8);
  const recipients=[];
  for(const m of accepted){
    const giverNumber=Number(m.to[0].match(/pessoa(\d)/)[1]);
    const recipient=m.text.match(/Seu amigo oculto é: (.*?)\. Guarde/)[1];
    assert.notEqual(NAMES[giverNumber],recipient,'ninguém se tira');
    recipients.push(recipient);
  }
  assert.equal(new Set(recipients).size,8,'nenhum nome sorteado duas vezes');
  const publicStatus=await jsonResponse(await worker.fetch(request(`/api/events/${event.id}`),env,session));
  assert.equal(publicStatus.status,'complete');
  assert.equal(publicStatus.sentCount,8);
  assert.ok(!NAMES.some(n=>JSON.stringify(publicStatus).includes(n)));
  assert.ok(!('participants' in publicStatus));
  const tooLate=await jsonResponse(await worker.fetch(request('/api/register','POST',{eventId:event.id,name:'Pessoa 1',email:'x@example.com'}),env,session));
  assert.equal(tooLate.status,409);
  const lateReset=await jsonResponse(await worker.fetch(request('/api/reset','POST',{
    eventId:event.id,name:'Pessoa 1',setupCode:env.HOST_SETUP_CODE}),env,session));
  assert.equal(lateReset.status,409,'nem o organizador pode alterar pares depois do sorteio');
});
