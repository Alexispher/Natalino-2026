const app = document.querySelector('#app');
const toastElement = document.querySelector('#toast');
const CONFIG = window.AMIGO_OCULTO_CONFIG || {};
const API = String(CONFIG.apiBase || '').replace(/\/+$/, '');
const configured = API.startsWith('https://') && !API.includes('SEU-WORKER');
const params = new URLSearchParams(window.location.search);
const eventId = params.get('evento');
let currentEvent = null;
let challenge = null;
let toastTimer;

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lockIcon = document.querySelector('#icon-lock').innerHTML;
const panelNote = (extra='Cada resultado é enviado individualmente. Ninguém vê o sorteio no site.') => `<div class="panel-note">${lockIcon}<span>${escapeHTML(extra)}</span></div>`;
const panel = (content, note) => `<div class="panel-body">${content}</div>${panelNote(note)}`;
const chip = (label, color='') => `<span class="chip"><span class="chip-dot ${color}"></span>${escapeHTML(label)}</span>`;

function toast(message) {
  toastElement.textContent = message;
  toastElement.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastElement.hidden = true; }, 4500);
}
function showError(message) {
  const target = document.querySelector('#form-error');
  if (target) { target.textContent = message; target.hidden = false; }
  else toast(message);
}
function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (!button.dataset.initial) button.dataset.initial = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? 'Só um instante…' : button.dataset.initial;
}
async function api(path, options={}) {
  if (!configured) throw new Error('Configure primeiro o endereço do backend no arquivo docs/config.js.');
  const response = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type':'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro de conexão (${response.status}).`);
  return data;
}
function shareURL(id) {
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('evento', id);
  return u.toString();
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Convite copiado! Agora é só mandar para a família.'); }
  catch { window.prompt('Copie o convite:', text); }
}
function renderHome() {
  app.innerHTML = panel(`
    <div class="panel-topline">${chip('Uma tradição só nossa')}<span class="panel-label">NATAL 2026</span></div>
    <div class="mail-mark" aria-hidden="true">✉</div>
    <h3 class="panel-title">Uma surpresa para cada pessoa.</h3>
    <p class="panel-desc">Oito participantes, oito surpresas e um segredo que só chega ao e-mail de quem deve recebê-lo. Crie o convite e compartilhe com a família.</p>
    <div class="callout"><span>✳</span><div><strong>Seus dados ficam em segredo.</strong><br>Cada convidado informa seu próprio nome e e-mail. Nenhuma lista de participantes fica pública.</div></div>
    <div class="host-panel">
      <p class="overline">PARA QUEM ORGANIZA</p>
      <h4 class="secondary-title">Criar o sorteio de 2026</h4>
      <p class="host-instructions">Use o código de criação configurado no servidor. Ele serve apenas para abrir a sala, nunca para revelar os resultados.</p>
      <form id="create-form">
        <div class="field"><label for="setup-code">Código de criação</label><input id="setup-code" name="setupCode" type="password" autocomplete="off" placeholder="Seu código privado" minlength="12" required /></div>
        <p class="error-text" id="form-error" hidden></p>
        <button class="primary-btn full-width" type="submit">Criar convite da família <span aria-hidden="true">↗</span></button>
      </form>
    </div>
  `, 'O código de criação nunca é salvo no navegador. O sorteio acontece no servidor.');
  document.querySelector('#create-form').addEventListener('submit', async e => {
    e.preventDefault(); const form = e.currentTarget; setBusy(form,true);
    try {
      const setupCode = form.elements.setupCode.value;
      const data = await api('/api/events', {method:'POST',body:{setupCode}});
      form.elements.setupCode.value = '';
      renderCreated(data.id);
    } catch(err) { showError(err.message); } finally { setBusy(form,false); }
  });
}
function renderCreated(id) {
  const url = shareURL(id);
  app.innerHTML = panel(`
    <div class="panel-topline">${chip('Convite criado')}<span class="panel-label">PASSO 1 DE 2</span></div>
    <div class="big-sparkle centered">✳</div><h3 class="panel-title centered">Pronto. A magia começou!</h3>
    <p class="panel-desc centered">Esse é o link do nosso amigo oculto. Compartilhe com a família para cada um confirmar seu próprio e-mail.</p>
    <div class="field"><label for="invite-url">Link privado do convite</label><div class="link-field"><input id="invite-url" value="${escapeHTML(url)}" readonly aria-label="Link do convite" /><button id="copy-link" type="button">Copiar</button></div></div>
    <div class="invite-actions"><button class="secondary-btn" id="whatsapp-link" type="button">Enviar pelo WhatsApp ↗</button><button class="primary-btn" id="open-room" type="button">Acompanhar inscrições →</button></div>
    <p class="subtle-text" style="margin-top:20px">Salve o link. Depois que as oito pessoas confirmarem seus códigos, o sorteio será feito automaticamente, sem botão para revelar os pares.</p>
  `);
  document.querySelector('#copy-link').addEventListener('click',() => copyText(url));
  document.querySelector('#whatsapp-link').addEventListener('click',() => {
    const text = `🎄 Amigo Oculto da Família • 25/11/2026\nEntre no link, informe seu nome e confirme seu e-mail para participar. O sorteio é secreto!\n\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  });
  document.querySelector('#open-room').addEventListener('click',() => window.location.assign(url));
}
function statusSlots(data) {
  return `<div class="status-grid anonymous-grid" aria-label="${data.verifiedCount} de ${data.total} inscrições confirmadas">${Array.from({length:data.total},(_,i)=>`<div class="status-person ${i<data.verifiedCount?'checked':''}"><span class="status-icon" aria-hidden="true">${i<data.verifiedCount?'✓':'·'}</span><strong>${i<data.verifiedCount?'Confirmado':'Aguardando'}</strong></div>`).join('')}</div>`;
}
function progress(data) {
  return `<div class="progress-header"><span>Presenças confirmadas</span><strong>${data.verifiedCount}<span style="font-size:14px;color:#a29d91"> / ${data.total}</span></strong></div><div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${data.total}" aria-valuenow="${data.verifiedCount}" aria-label="Participantes confirmados"><div style="width:${Math.round(data.verifiedCount/data.total*100)}%"></div></div>`;
}
function inviteTools(data) {
  const url = shareURL(data.id);
  return `<div class="invite-actions"><button class="secondary-btn" type="button" id="copy-invite">Copiar convite</button><button class="secondary-btn" type="button" id="refresh-status">Atualizar lista ↻</button></div>`;
}
function bindInviteActions(data) {
  document.querySelector('#copy-invite')?.addEventListener('click',()=>copyText(shareURL(data.id)));
  document.querySelector('#refresh-status')?.addEventListener('click',async()=>{
    try {await refreshEvent();toast('Lista atualizada.');} catch(err) {toast(err.message);}
  });
}
function organizerCorrection(data) {
  return `<details class="organizer-correction">
    <summary>Organizador: corrigir um cadastro</summary>
    <p class="subtle-text">Se alguém informou o e-mail errado ou digitou o nome incorretamente, informe o nome cadastrado e libere o registro antes do sorteio. Isso não revela resultados.</p>
    <form id="reset-form">
      <div class="field"><label for="reset-person">Nome informado no cadastro</label><input id="reset-person" type="text" name="name" minlength="2" maxlength="60" autocomplete="off" placeholder="Digite o nome que precisa ser liberado" required /></div>
      <div class="field"><label for="reset-code">Código privado do organizador</label><input id="reset-code" name="setupCode" type="password" autocomplete="off" required minlength="12" placeholder="Mesmo código de criação" /></div>
      <p class="error-text" id="reset-error" hidden></p>
      <button class="secondary-btn full-width" type="submit">Liberar cadastro para uma nova tentativa</button>
    </form>
  </details>`;
}
function bindCorrection(data) {
  document.querySelector('#reset-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const name=form.elements.name.value;
    if (!window.confirm(`Liberar o cadastro de ${name}? A pessoa precisará confirmar o e-mail novamente.`)) return;
    setBusy(form,true);
    try {
      await api('/api/reset',{method:'POST',body:{eventId:data.id,name,setupCode:form.elements.setupCode.value}});
      form.elements.setupCode.value='';
      toast('Inscrição liberada. Peça à pessoa para se cadastrar de novo.');
      await refreshEvent();
    } catch (error) {
      const display=document.querySelector('#reset-error');
      if(display){display.textContent=error.message;display.hidden=false;} else toast(error.message);
    } finally {setBusy(form,false);}
  });
}
function renderEvent(data) {
  currentEvent=data;
  if (data.status === 'complete') { renderFinished(data); return; }
  if (data.status === 'sending') { renderSending(data); return; }
  const pending = readPending(data.id);
  if(pending) {challenge=pending;renderVerify(data);return;}
  app.innerHTML = panel(`
    <div class="panel-topline">${chip('Inscrições abertas')}<span class="panel-label">25 · 11 · 2026</span></div>
    <h3 class="panel-title">Faça parte da surpresa.</h3>
    <p class="panel-desc">Informe seu nome e o e-mail em que deseja receber a surpresa. Para garantir que ninguém fique de fora, vamos enviar um código de confirmação.</p>
    ${progress(data)}
    ${statusSlots(data)}
    <hr class="ui-divider" />
    <form id="register-form">
      <div class="field"><label for="person-name">Meu nome</label><input id="person-name" name="name" type="text" autocomplete="name" minlength="2" maxlength="60" placeholder="Como você quer ser chamado?" required /></div>
      <div class="field"><label for="email">Meu melhor e-mail</label><input id="email" type="email" name="email" autocomplete="email" placeholder="voce@exemplo.com" required maxlength="254" /></div>
      <p class="error-text" id="form-error" hidden></p>
      <button class="primary-btn full-width" ${data.verifiedCount < data.total ? '' : 'disabled'} type="submit">Receber código de confirmação <span aria-hidden="true">→</span></button>
    </form>
    <p class="stage-bottom-caption">${data.verifiedCount === 0?'Seja o primeiro a confirmar sua presença!':'Somente inscrições confirmadas entram no sorteio.'}</p>
    <div class="divider-text">COMPARTILHAR COM A FAMÍLIA</div>${inviteTools(data)}${organizerCorrection(data)}
  `);
  bindInviteActions(data);
  bindCorrection(data);
  document.querySelector('#register-form').addEventListener('submit', async e => {
    e.preventDefault();const form=e.currentTarget;setBusy(form,true);
    try {
      const name = form.elements.name.value; const email = form.elements.email.value.trim();
      const response=await api('/api/register',{method:'POST',body:{eventId:data.id,name,email}});
      challenge={name,email,token:response.challengeToken};writePending(data.id,challenge);renderVerify(data);
    } catch(err){showError(err.message);} finally{setBusy(form,false);}
  });
}
function pendingKey(id){return `amigo-oculto-challenge-${id}`;}
function readPending(id){try{return JSON.parse(sessionStorage.getItem(pendingKey(id)));}catch{return null;}}
function writePending(id,claim){try{sessionStorage.setItem(pendingKey(id),JSON.stringify(claim));}catch{}}
function clearPending(id){try{sessionStorage.removeItem(pendingKey(id));}catch{}}
function maskEmail(email){const [local,domain='']=(email||'').split('@');return `${local.slice(0,2)}${'*'.repeat(Math.min(Math.max(local.length-2,1),6))}@${domain}`;}
function renderVerify(data){
  if (!challenge) {renderEvent(data);return;}
  app.innerHTML=panel(`
    <div class="panel-topline">${chip('Verificação pendente','gold')}<span class="panel-label">PASSO 2 DE 2</span></div>
    <div class="mail-mark" aria-hidden="true">✉</div>
    <h3 class="panel-title">Olha sua caixa de entrada.</h3>
    <p class="panel-desc">Enviamos um código de 6 dígitos para <strong>${escapeHTML(maskEmail(challenge.email))}</strong>. Digite-o abaixo para confirmar a presença de <strong>${escapeHTML(challenge.name)}</strong>.</p>
    <form id="verify-form">
      <div class="field"><label for="verification-code">Seu código de confirmação</label><input class="otp-input" id="verification-code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" autocomplete="one-time-code" placeholder="000000" required /></div>
      <p class="error-text" id="form-error" hidden></p>
      <button class="primary-btn full-width" type="submit">Confirmar minha presença →</button>
    </form>
    <p class="subtle-text" style="margin-top:18px">O código vale por 15 minutos. Confira também a pasta de spam.</p>
    <button class="link-btn" type="button" id="edit-email">Corrigir e-mail ou nome</button>
  `,'O código é usado apenas para verificar o e-mail. Ele não revela o sorteio.');
  document.querySelector('#edit-email').addEventListener('click',()=>{clearPending(data.id);challenge=null;renderEvent(data);});
  document.querySelector('#verify-form').addEventListener('submit',async e=>{
    e.preventDefault(); const form=e.currentTarget;setBusy(form,true);
    try{
      await api('/api/verify',{method:'POST',body:{eventId:data.id,name:challenge.name,challengeToken:challenge.token,code:form.elements.code.value}});
      clearPending(data.id);challenge=null;
      const updated=await api(`/api/events/${encodeURIComponent(data.id)}`);
      renderConfirmed(updated);
    }catch(err){showError(err.message);}finally{setBusy(form,false);}
  });
}
function renderConfirmed(data){
  currentEvent=data;
  app.innerHTML=panel(`
    <div class="panel-topline">${chip('Presença confirmada')}<span class="panel-label">TUDO CERTO</span></div>
    <div class="big-sparkle centered">✳</div>
    <h3 class="panel-title centered">Você já faz parte da surpresa.</h3>
    <p class="panel-desc centered">Seu e-mail foi confirmado! Quando as oito pessoas estiverem prontas, cada participante receberá seu amigo oculto individualmente.</p>
    ${progress(data)}${statusSlots(data)}
    <div class="callout success" style="margin:24px 0"><span>✓</span><div><strong>Presença garantida.</strong><br>Você não precisa fazer mais nada. O sorteio é automático.</div></div>
    ${inviteTools(data)}
    ${data.status==='open'?organizerCorrection(data):''}
  `);
  bindInviteActions(data);
  bindCorrection(data);
}
function renderSending(data){
  app.innerHTML=panel(`<div class="panel-topline">${chip('Sorteio realizado','gold')}<span class="panel-label">A SURPRESA ESTÁ A CAMINHO</span></div><div class="big-sparkle centered">✳</div><h3 class="panel-title centered">O segredo já foi sorteado.</h3><p class="panel-desc centered">Todo mundo confirmou! Estamos enviando os resultados de maneira individual. Confira seu e-mail nos próximos minutos.</p>${progress(data)}${statusSlots(data)}<div class="callout"><span>✉</span><div><strong>Cartinhas a caminho.</strong><br>Envios aceitos pelo serviço de e-mail: ${data.sentCount} de ${data.total}. Se necessário, o sistema tenta novamente.</div></div><div class="divider-text">ATUALIZAR</div>${inviteTools(data)}`);
  bindInviteActions(data);
}
function renderFinished(data){
  app.innerHTML=panel(`<div class="panel-topline">${chip('Sorteio concluído')}<span class="panel-label">FELIZ NATAL!</span></div><div class="big-sparkle centered">✳</div><h3 class="panel-title centered">Os segredos foram enviados.</h3><p class="panel-desc centered">As oito surpresas foram encaminhadas para os e-mails confirmados. Agora é guardar o segredo e preparar o presente!</p>${statusSlots(data)}<div class="callout success" style="margin:24px 0"><span>♥</span><div><strong>O que importa fica entre nós.</strong><br>O site não mostra quem tirou quem — nem para quem criou o convite.</div></div><div class="divider-text">CONVITE</div>${inviteTools(data)}`,'Os envios foram aceitos pelo provedor. Confira sua caixa de entrada e spam.');
  bindInviteActions(data);
}
async function refreshEvent(){
  if (!eventId) return;
  const data=await api(`/api/events/${encodeURIComponent(eventId)}`);
  currentEvent=data;
  if (document.querySelector('#verify-form') || document.querySelector('#register-form')) {
    if (data.status==='sending'||data.status==='complete') renderEvent(data);
    else if (document.querySelector('#register-form')) renderEvent(data);
  } else renderEvent(data);
}
async function init(){
  if (!eventId){renderHome();return;}
  if (!/^[A-Za-z0-9_-]{16,60}$/.test(eventId)) {
    app.innerHTML=panel('<h3 class="panel-title">Convite inválido.</h3><p class="panel-desc">Confira se o link enviado pela família está completo.</p>'); return;
  }
  if (!configured){
    app.innerHTML=panel('<h3 class="panel-title">O correio de Natal ainda não foi conectado.</h3><p class="panel-desc">Quem está instalando o site precisa configurar o endereço do backend em <code>docs/config.js</code> para ativar o sorteio.</p>');return;
  }
  try {const data=await api(`/api/events/${encodeURIComponent(eventId)}`); renderEvent(data);}
  catch(err){app.innerHTML=panel(`<h3 class="panel-title">Não conseguimos abrir o convite.</h3><p class="panel-desc">${escapeHTML(err.message)}</p><button class="secondary-btn" id="try-again">Tentar novamente</button>`);document.querySelector('#try-again').addEventListener('click',init);}
  setInterval(async()=>{
    if (document.visibilityState!=='visible' || !currentEvent || currentEvent.status==='complete')return;
    if(document.querySelector('#register-form')||document.querySelector('#verify-form'))return;
    try{await refreshEvent();}catch{}
  },30000);
}
init();
