import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ROLE_APPS, appsFor, membershipsForApp, ROLE_LABEL, VINCULO_LABEL,
  isGestor, isPortaria, isSindico, NAV_SVG, tabsFor,
  fmtDate, esc, fmtNum, compLabel, fmtBytes, fmtMoney, unitLabel,
  OC_CAT, OC_STATUS, urlBase64ToUint8Array, abToB64u
} from "./helpers.js";

// ===================================================================
// CONFIG — preencha com o seu projeto Supabase (Project Settings → API)
// ===================================================================
const SUPABASE_URL  = "https://bklvbhsaxcmrnjxjbzjh.supabase.co";      // projeto CondoApp
const SUPABASE_ANON = "sb_publishable_7ci7VKQf-aUPvfpckRhK9A_fRmf8JQa"; // publishable key (pública)
// Chave pública VAPID do Web Push (pública; a privada é secret da Edge Function)
const VAPID_PUBLIC = "BJeUbCaT-75qLroDtQvhI-yy-LN5AzTH67ymOqx4kO-0S9YinNIXpnJYJQYLrV1T6WCA12sl6p_MOuUOT_nlfjw";

const CONFIGURED = !SUPABASE_URL.startsWith("COLE_");
const sb = CONFIGURED ? createClient(SUPABASE_URL, SUPABASE_ANON) : null;

// ===================================================================
// PAPEL DO ARQUIVO (morador.html / sindico.html / portaria.html definem
// window.APP_ROLE; a tela de login não define — ela roteia por papel).
// ===================================================================
// Arquivo único (condominio.html): window.APP_ROLE não é definido → SINGLE=true,
// e o app roteia por papel INLINE (sem redirecionar para /morador etc.).
// (compat: se algum arquivo antigo ainda definir window.APP_ROLE, mantém o modo travado.)
let APP_ROLE = (typeof window !== "undefined" && window.APP_ROLE) ? String(window.APP_ROLE) : null;
const SINGLE = !APP_ROLE;
const APP_LABEL = { morador:"Morador", sindico:"Síndico", portaria:"Portaria" };
// ROLE_APPS, appsFor, membershipsForApp: em ./helpers.js
function gotoApp(app){ if(SINGLE){ APP_ROLE = app; enterApp(); } else { location.href = "/" + app; } }

// ---------- estado ----------
const S = { user:null, profile:null, memberships:[], condId:null, cond:null, role:null, tab:"inicio" };

// helpers puros (ROLE_LABEL, VINCULO_LABEL, isGestor/isPortaria/isSindico,
// NAV_SVG, tabsFor, fmtDate, esc, OC_CAT, OC_STATUS...): em ./helpers.js
// telas acessadas pelo hub "Serviços" (destacam a aba Serviços na barra)
const HUB_TABS = ["servicos","painel","reservas","financeiro","contas","assembleias","enquetes","manutencoes","mural","documentos","livro","gestao","atendimento","cadastros","vagas","autorizacoes","conversas","pesquisas","consumo","sos"];
// ---------- UI utils ----------
const $ = s => document.querySelector(s);
const view = () => $("#view");
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2400); }
function sheet(html){ $("#sheet").innerHTML = '<div class="grab"></div>'+html; $("#sheetBg").classList.add("show"); }
function closeSheet(){ $("#sheetBg").classList.remove("show"); if(typeof pararToque==="function") pararToque(); }
$("#sheetBg").addEventListener("click",e=>{ if(e.target.id==="sheetBg") closeSheet(); });
// modal de confirmação (substitui o confirm() nativo) — retorna Promise<boolean>
function confirmar(msg, okLabel="Confirmar"){
  return new Promise(resolve=>{
    sheet(`<h2>Confirmar</h2><p class="sub" style="margin:2px 0 4px">${esc(msg)}</p>
      <div class="seg" style="margin-top:12px">
        <button class="btn secondary" id="cfNo" style="width:auto;margin:0">Cancelar</button>
        <button class="btn" id="cfYes" style="width:auto;margin:0">${esc(okLabel)}</button></div>`);
    let done=false; const bg=$("#sheetBg");
    const finish=(v)=>{ if(done) return; done=true; bg.removeEventListener("click",onBg); resolve(v); closeSheet(); };
    const onBg=e=>{ if(e.target.id==="sheetBg") finish(false); };
    bg.addEventListener("click",onBg);
    $("#cfYes").addEventListener("click",()=>finish(true));
    $("#cfNo").addEventListener("click",()=>finish(false));
  });
}
function loading(){ view().innerHTML='<div class="spin"></div>'; }

async function rpc(fn,args){ const {data,error}=await sb.rpc(fn,args); if(error){ if(fn!=="log_evento") logEvento("error","rpc:"+fn,error.message,{code:error.code}); throw error; } return data; }
// ---- Observabilidade: log de erros do cliente (best-effort, nunca quebra o app) ----
const _logDedup=new Set();
async function logEvento(nivel,contexto,mensagem,detalhe){
  try{
    if(!S.user) return; // só logados
    const key=(contexto||"")+"|"+String(mensagem||"").slice(0,120);
    if(_logDedup.has(key)) return; _logDedup.add(key); setTimeout(()=>_logDedup.delete(key),60000);
    await sb.rpc("log_evento",{p_nivel:nivel||"error",p_contexto:contexto||null,p_mensagem:String(mensagem||"").slice(0,500),p_detalhe:detalhe||null,p_url:(location.hash||location.pathname||"").slice(0,300),p_app:APP_ROLE||"app",p_cond:S.condId||null});
  }catch(_){/* silencioso */}
}
if(typeof window!=="undefined"){
  window.addEventListener("error",e=>{ logEvento("error","window.onerror",e.message||"erro",{src:e.filename,line:e.lineno,col:e.colno}); });
  window.addEventListener("unhandledrejection",e=>{ const r=e.reason; logEvento("error","unhandledrejection",(r&&(r.message||r))||"promise rejeitada",(r&&r.stack)?{stack:String(r.stack).slice(0,400)}:null); });
}

// ---------- ANEXOS (fotos/arquivos em ocorrências/comunicados) ----------
async function uploadAnexos(escopo, refId, files){
  for(const f of files){
    const safe=f.name.replace(/[^a-zA-Z0-9.\-_]/g,"_");
    const path=`${S.condId}/${escopo}/${refId}/${crypto.randomUUID()}-${safe}`;
    const up=await sb.storage.from("anexos").upload(path,f,{contentType:f.type||"application/octet-stream"});
    if(up.error) throw up.error;
    await rpc("anexo_registrar",{p_cond:S.condId,p_escopo:escopo,p_ref:refId,p_path:path,p_nome:f.name,p_mime:f.type||null,p_tamanho:f.size});
  }
}
async function fetchAnexos(escopo, refIds){
  if(!refIds||!refIds.length) return {};
  const {data}=await sb.from("anexos").select("*").eq("escopo",escopo).in("ref_id",refIds).order("created_at");
  const list=data||[]; if(!list.length) return {};
  const {data:signed}=await sb.storage.from("anexos").createSignedUrls(list.map(a=>a.storage_path),3600);
  const urlByPath={}; (signed||[]).forEach(s=>{ if(s.signedUrl) urlByPath[s.path]=s.signedUrl; });
  const map={};
  list.forEach(a=>{ (map[a.ref_id]=map[a.ref_id]||[]).push({...a,url:urlByPath[a.storage_path]}); });
  return map;
}
function anexoThumbs(arr){
  if(!arr||!arr.length) return "";
  return `<div class="anexos">`+arr.map(a=>{
    return (a.mime||"").startsWith("image/")
      ? `<a href="${a.url}" target="_blank" rel="noopener" class="anexo"><img src="${a.url}" alt="${esc(a.nome||"")}" loading="lazy"></a>`
      : `<a href="${a.url}" target="_blank" rel="noopener" class="anexo file">📎 ${esc((a.nome||"arquivo").slice(0,20))}</a>`;
  }).join("")+`</div>`;
}

// ---------- QR (gerar código do visitante + ler na portaria) ----------
function qrImg(text, cell=6){
  try{ if(typeof qrcode==="undefined") return ""; const qr=qrcode(0,"M"); qr.addData(String(text)); qr.make(); return qr.createImgTag(cell, 8); }
  catch(_){ return ""; }
}
function qrDataUrl(text, cell=7){
  const tag=qrImg(text,cell); const m=/src="([^"]+)"/.exec(tag||""); return m?m[1]:"";
}
// número no formato do WhatsApp (adiciona 55 quando parece só DDD+número)
function waPhone(raw){ let d=(raw||"").replace(/\D/g,""); if(!d) return ""; if(d.length<=11 && !d.startsWith("55")) d="55"+d; return d; }
function waMsgVisitante(v){
  const cond=(S.cond&&S.cond.nome)||"condomínio";
  const val=v.validade_ate?("válido até "+new Date(v.validade_ate).toLocaleString("pt-BR")):"sem prazo de expiração";
  return `Olá${v.nome_visitante?" "+v.nome_visitante:""}! Sua autorização de visita ao ${cond} está pronta.\n\n🔑 Código de acesso: ${v.codigo}\n⏳ ${val}\n\nMostre este código (ou o QR enviado) na portaria para entrar.`;
}
function enviarWhatsAppVisitante(v){
  const ph=waPhone(v.telefone);
  window.open(`https://wa.me/${ph}?text=${encodeURIComponent(waMsgVisitante(v))}`,"_blank","noopener");
}
async function compartilharQR(v){
  const url=qrDataUrl(v.codigo,7); if(!url) return toast("QR indisponível.");
  try{
    const blob=await (await fetch(url)).blob();
    const file=new File([blob],`visitante-${v.codigo}.gif`,{type:blob.type||"image/gif"});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], text:waMsgVisitante(v), title:"QR do visitante"});
    } else {
      enviarWhatsAppVisitante(v); // fallback: manda o texto pelo WhatsApp
    }
  }catch(e){ if(e && e.name!=="AbortError") toast("Não foi possível compartilhar."); }
}
let _qrStream=null, _qrRaf=null;
function fecharScanner(){
  if(_qrRaf){ cancelAnimationFrame(_qrRaf); _qrRaf=null; }
  if(_qrStream){ _qrStream.getTracks().forEach(t=>t.stop()); _qrStream=null; }
  document.getElementById("qrScanWrap")?.remove();
}
async function abrirScannerQR(onResult){
  if(typeof jsQR==="undefined") return toast("Leitor de QR indisponível (sem conexão).");
  const wrap=document.createElement("div"); wrap.id="qrScanWrap";
  wrap.style.cssText="position:fixed;inset:0;z-index:80;background:#000;display:flex;flex-direction:column";
  wrap.innerHTML=`<div style="padding:calc(env(safe-area-inset-top) + 12px) 16px 12px;color:#fff;display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.4)">
      <b style="flex:1">Aponte para o QR do visitante</b>
      <button id="qrCancel" class="iconbtn" aria-label="Fechar" style="background:rgba(255,255,255,.15);color:#fff">✕</button></div>
    <div style="flex:1;position:relative;overflow:hidden">
      <video id="qrVideo" playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
      <div style="position:absolute;inset:0;display:grid;place-items:center;pointer-events:none">
        <div style="width:220px;height:220px;border:3px solid #fff;border-radius:16px;box-shadow:0 0 0 9999px rgba(0,0,0,.35)"></div></div>
    </div>
    <div style="padding:14px;color:#fff;text-align:center;font-size:13px;background:rgba(0,0,0,.4)">Procurando código…</div>`;
  document.body.appendChild(wrap);
  document.getElementById("qrCancel").onclick=fecharScanner;
  const video=document.getElementById("qrVideo");
  const canvas=document.createElement("canvas"); const ctx=canvas.getContext("2d",{willReadFrequently:true});
  try{
    _qrStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
    video.srcObject=_qrStream; await video.play();
  }catch(e){ fecharScanner(); toast("Não consegui acessar a câmera. Digite o código manualmente."); return; }
  const tick=()=>{
    if(!_qrStream) return;
    if(video.readyState>=video.HAVE_ENOUGH_DATA){
      canvas.width=video.videoWidth; canvas.height=video.videoHeight;
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const img=ctx.getImageData(0,0,canvas.width,canvas.height);
      const code=jsQR(img.data,img.width,img.height,{inversionAttempts:"dontInvert"});
      if(code && code.data){ const data=code.data; fecharScanner(); onResult(data); return; }
    }
    _qrRaf=requestAnimationFrame(tick);
  };
  _qrRaf=requestAnimationFrame(tick);
}

// ===================================================================
// AUTH
// ===================================================================
let signup = false;
function renderAuthMode(){
  $("#authBtn").textContent = signup ? "Criar conta" : "Entrar";
  $("#switchTxt").textContent = signup ? "Já tem conta?" : "Ainda não tem conta?";
  $("#switchBtn").textContent = signup ? "Fazer login" : "Criar conta";
  $("#nameLbl").classList.toggle("hide",!signup);
  $("#name").classList.toggle("hide",!signup);
}
$("#switchBtn")?.addEventListener("click",()=>{ signup=!signup; renderAuthMode(); });

// Login unificado: sem seletor manual de papel. A categoria é decidida pelos
// vínculos da conta após o login (ver showRoleChooser). __loginTarget é usado
// só como atalho interno (ex.: após cadastrar um novo condomínio → síndico).
window.__loginTarget = null;
try{ localStorage.removeItem("vz-login-target"); }catch(_){}  // limpa preferência antiga do seletor

// Aviso de consentimento / LGPD na tela de login (clickwrap no cadastro)
(function privacyNotice(){
  const form=$("#authForm"); if(!form||$("#privNote")) return;
  const d=document.createElement("div");
  d.id="privNote"; d.className="switch"; d.style.cssText="margin-top:10px;font-size:12.5px";
  d.innerHTML='Ao criar conta, você concorda com os <a href="/termos" target="_blank" rel="noopener">Termos de Uso</a> e a <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.';
  form.appendChild(d);
})();

function authErr(m){ const e=$("#authErr"); if(!m){e.classList.remove("show");return;} e.textContent=m; e.classList.add("show"); }

$("#authBtn")?.addEventListener("click", async ()=>{
  if(!CONFIGURED){ authErr("Configure SUPABASE_URL e SUPABASE_ANON no topo do arquivo."); return; }
  const email=$("#email").value.trim(), pass=$("#pass").value, name=$("#name").value.trim();
  if(!email||!pass){ authErr("Preencha e-mail e senha."); return; }
  $("#authBtn").disabled=true; authErr("");
  try{
    if(signup){
      const {data,error}=await sb.auth.signUp({email,password:pass,options:{data:{nome:name}}});
      if(error) throw error;
      if(data.user && name){ try{ await rpc("perfil_salvar",{p_nome:name}); }catch(_){} }
      if(!data.session){ authErr("Conta criada. Verifique seu e-mail para confirmar e depois entre."); signup=false; renderAuthMode(); $("#authBtn").disabled=false; return; }
    } else {
      const {error}=await sb.auth.signInWithPassword({email,password:pass});
      if(error) throw error;
    }
    await boot();
  }catch(e){ authErr(traduzErro(e)); }
  $("#authBtn").disabled=false;
});
function traduzErro(e){
  const m=(e?.message||"").toLowerCase();
  if(m.includes("invalid login")) return "E-mail ou senha incorretos.";
  if(m.includes("already registered")) return "Este e-mail já tem conta.";
  if(m.includes("password")) return "Senha muito curta (mín. 6 caracteres).";
  if(m.includes("rate limit")||m.includes("too many")) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  return e?.message||"Erro inesperado.";
}
function authMsg(m){ const e=$("#authMsg"); if(!m){e.classList.remove("show");return;} e.textContent=m; e.classList.add("show"); }

// ---------- Esqueci minha senha ----------
$("#forgotBtn")?.addEventListener("click", async ()=>{
  const email=$("#email").value.trim();
  if(!email){ authErr("Digite seu e-mail acima e toque em \"Esqueci minha senha\"."); return; }
  authErr(""); authMsg("");
  $("#forgotBtn").disabled=true;
  try{
    const redirectTo=location.origin+location.pathname; // volta pra esta mesma tela
    const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo});
    if(error) throw error;
    authMsg("Enviamos um link para "+email+". Abra o e-mail para redefinir a senha.");
  }catch(e){ authErr(traduzErro(e)); }
  $("#forgotBtn").disabled=false;
});

// ---------- Login por link mágico (sem senha) ----------
$("#magicBtn")?.addEventListener("click", async ()=>{
  const email=$("#email").value.trim();
  if(!email){ authErr("Digite seu e-mail para receber o link de acesso."); return; }
  authErr(""); authMsg("");
  $("#magicBtn").disabled=true;
  try{
    const redirectTo=location.origin+location.pathname;
    const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo}});
    if(error) throw error;
    authMsg("Enviamos um link de acesso para "+email+". Toque no link do e-mail para entrar.");
  }catch(e){ authErr(traduzErro(e)); }
  $("#magicBtn").disabled=false;
});

// ---------- Definir nova senha (após clicar no link de recuperação) ----------
let _recovering=false;
function rsErr(m){ const e=$("#rsErr"); if(!m){e.classList.remove("show");return;} e.textContent=m; e.classList.add("show"); }
function rsMsg(m){ const e=$("#rsMsg"); if(!m){e.classList.remove("show");return;} e.textContent=m; e.classList.add("show"); }
function showResetScreen(){ _recovering=true; rsErr(""); rsMsg(""); $("#rsPass").value=""; $("#rsPass2").value=""; showScreen("reset"); }
$("#rsSave")?.addEventListener("click", async ()=>{
  const p1=$("#rsPass").value, p2=$("#rsPass2").value;
  if(!p1||p1.length<6){ rsErr("A senha precisa ter ao menos 6 caracteres."); return; }
  if(p1!==p2){ rsErr("As senhas não conferem."); return; }
  rsErr(""); $("#rsSave").disabled=true;
  try{
    const {error}=await sb.auth.updateUser({password:p1});
    if(error) throw error;
    _recovering=false;
    rsMsg("Senha atualizada! Entrando…");
    setTimeout(()=>boot().catch(e=>console.error(e)),700);
  }catch(e){ rsErr(traduzErro(e)); $("#rsSave").disabled=false; }
});
$("#rsCancel")?.addEventListener("click", async ()=>{
  _recovering=false; try{ await sb.auth.signOut(); }catch(_){}
  location.hash=""; showScreen("auth");
});
// Supabase dispara PASSWORD_RECOVERY quando a página abre pelo link de recuperação
if(sb){ sb.auth.onAuthStateChange((event)=>{ if(event==="PASSWORD_RECOVERY") showResetScreen(); }); }

// ===================================================================
// BOOT / TENANT
// ===================================================================
async function boot(){
  const {data:{user}} = await sb.auth.getUser();
  if(!user){ if(APP_ROLE && !SINGLE){ location.href="/login"; return; } showScreen("auth"); return; }
  if(await mfaPendente()){ showMfaChallenge(); return; }  // exige 2FA antes de entrar
  S.user=user;
  // aceita convites pendentes vinculados ao e-mail deste usuário
  try{ await rpc("convites_aceitar"); }catch(_){}
  // persiste o nome do cadastro (guardado no metadata) na 1ª sessão
  try{
    const nomeMeta=user.user_metadata?.nome;
    if(nomeMeta){
      const {data:prof}=await sb.from("profiles").select("nome").eq("id",user.id).maybeSingle();
      if(!prof || !prof.nome){ await rpc("perfil_salvar",{p_nome:nomeMeta}); }
    }
  }catch(_){}
  const {data:ms} = await sb.from("memberships")
    .select("id,role,condominio_id,unidade_id,condominios(nome,cidade,uf)")
    .eq("user_id",user.id).eq("ativo",true);
  S.memberships = ms||[];
  routeAfterAuth();
}
// Decide para onde ir depois do login:
//  - arquivo de papel (APP_ROLE): entra no app travado naquele papel;
//  - tela de login (sem APP_ROLE): mostra o seletor de papel e redireciona.
function routeAfterAuth(){
  if(APP_ROLE) return enterApp();
  return showRoleChooser();
}
// arquivo de papel: filtra os vínculos compatíveis e entra
function enterApp(){
  const list = membershipsForApp(S.memberships, APP_ROLE);
  S._appList = list;
  // Sem vínculo neste papel: roteia para a categoria padrão do usuário
  // (ou mostra o cadastro, se ele não participa de nenhum condomínio).
  if(list.length===0){ showRoleChooser(); return; }
  if(list.length===1){ enterCond(list[0]); return; }
  renderPick(list); showScreen("pick");
}
// Prioridade fixa quando a conta tem mais de uma categoria: síndico > portaria > morador.
const APP_PRIORITY = ["sindico","portaria","morador"];
// Login unificado: roteia automaticamente pela categoria da conta (igual à
// imobiliária) — sem seletor manual de papel. Só mostra tela quando o usuário
// ainda não participa de nenhum condomínio.
function showRoleChooser(msg, force){
  const apps = appsFor(S.memberships);
  if(!msg && !force && apps.length){
    const target = (window.__loginTarget && apps.includes(window.__loginTarget))
      ? window.__loginTarget                                  // atalho pós-cadastro (novo condomínio → síndico)
      : (APP_PRIORITY.find(a=>apps.includes(a)) || apps[0]);  // categoria padrão por prioridade
    gotoApp(target); return;
  }
  const box = $("#roleList");
  if(box){
    const order=["morador","sindico","portaria"];
    const IC={morador:"🏠",sindico:"🧑‍💼",portaria:"🛎️"};
    const btns = order.filter(a=>apps.includes(a)).map(a=>`
      <button class="tile rolepick" data-app="${a}" style="width:100%;text-align:left;margin-bottom:10px">
        <div class="row"><span style="font-size:24px">${IC[a]}</span>
          <div><h3>${APP_LABEL[a]}</h3><p style="margin-top:2px">Entrar como ${APP_LABEL[a].toLowerCase()}</p></div>
          <span style="margin-left:auto;font-size:20px;color:var(--muted)">›</span></div></button>`).join("");
    box.innerHTML = (msg?`<p class="err show" style="margin:0 0 12px">${esc(msg)}</p>`:"")
      + (btns || '<p class="sub">Você ainda não participa de nenhum condomínio. Cadastre um novo abaixo ou peça um convite ao síndico.</p>');
    box.querySelectorAll("[data-app]").forEach(b=>b.addEventListener("click",()=>gotoApp(b.dataset.app)));
  }
  showScreen("roles");
}
function showScreen(id){
  for(const s of ["auth","reset","roles","pick","app"]) $("#"+s)?.classList.toggle("hide", s!==id);
}
function renderPick(listArg){
  const list=$("#pickList");
  const items = listArg || S.memberships;
  if(items.length===0){ list.innerHTML='<p class="sub">Você ainda não participa de nenhum condomínio. Peça o convite ao síndico ou cadastre um novo.</p>'; return; }
  list.innerHTML = items.map((m,i)=>`
    <button class="tile" data-i="${i}" style="width:100%;text-align:left;margin-bottom:10px">
      <div class="row"><span style="font-size:22px">🏢</span>
        <div><h3>${esc(m.condominios?.nome||"Condomínio")}</h3>
        <p style="margin-top:2px">${esc(ROLE_LABEL[m.role])}${m.condominios?.cidade?" · "+esc(m.condominios.cidade):""}</p></div>
      </div></button>`).join("");
  list.querySelectorAll("[data-i]").forEach(b=>b.addEventListener("click",()=>enterCond(items[+b.dataset.i])));
}
function enterCond(m){
  S.condId=m.condominio_id;
  // Trava a visão no papel do arquivo. No app do síndico mantém o papel real
  // (síndico/conselho/super_admin) para o gating de gestão ficar correto.
  S.role = APP_ROLE ? (APP_ROLE==="sindico" ? m.role : APP_ROLE) : m.role;
  S.membershipRole = m.role;
  S.cond=m.condominios||{nome:"Condomínio"};
  S.unidadeId=m.unidade_id||null;
  $("#condName").textContent=S.cond.nome||"Condomínio";
  $("#condSub").textContent=(S.cond.cidade?S.cond.cidade+(S.cond.uf?"/"+S.cond.uf:""):"")||"—";
  $("#roleChip").textContent=APP_LABEL[APP_ROLE]||ROLE_LABEL[S.role];
  buildNav();
  showScreen("app");
  maybeShowInstallBar();
  go(location.hash.replace("#","")||"inicio");
  refreshNotifBadge();
  if(notifTimer) clearInterval(notifTimer);
  notifTimer=setInterval(refreshNotifBadge,45000);
  iniciarInterfone();
  iniciarChegadasLive();
  ensurePush();                              // re-assina com a chave atual (auto-cura)
  setTimeout(talvezPedirPush, 2500);         // convida a ligar avisos (morador, 1x)
}
$("#switchCond").addEventListener("click",()=>{ renderPick(APP_ROLE?membershipsForApp(S.memberships,APP_ROLE):S.memberships); showScreen("pick"); });
$("#switchRole")?.addEventListener("click",()=>{ if(SINGLE){ APP_ROLE=null; S.condId=null; showRoleChooser(null,true); } else { location.href="/login"; } });
function novoCondominio(){
  sheet(`<h2>Novo condomínio</h2><p class="sub">Você será o administrador dele.</p>
    <label>Nome</label><input id="ncNome" class="field" placeholder="Ed. Aurora">
    <label>Cidade</label><input id="ncCidade" class="field" placeholder="Petrópolis">
    <label>UF</label><input id="ncUf" class="field" maxlength="2" placeholder="RJ">
    <button class="btn" id="ncSave">Cadastrar</button>`);
  $("#ncSave").addEventListener("click",async()=>{
    const nome=$("#ncNome").value.trim(); if(!nome) return toast("Informe o nome.");
    try{
      await rpc("cond_criar",{p_nome:nome,p_cidade:$("#ncCidade").value.trim()||null,p_uf:$("#ncUf").value.trim()||null});
      closeSheet(); toast("Condomínio criado 🎉");
      // quem cria vira síndico: na tela de login vai pro app do síndico
      if(!APP_ROLE){ window.__loginTarget="sindico"; }
      await boot();
    }catch(e){ toast(e.message); }
  });
}
$("#newCondBtn")?.addEventListener("click",novoCondominio);
$("#newCondBtnR")?.addEventListener("click",novoCondominio);
$("#logoutBtn2")?.addEventListener("click",logout);
$("#logoutBtn3")?.addEventListener("click",logout);
async function logout(){ if(notifTimer) clearInterval(notifTimer); pararConvPoll(); pararInterfone(); pararChegadasLive(); $("#notifDot")?.classList.add("hide"); try{ await sb.auth.signOut(); }catch(_){} window.__loginTarget=null; location.href = SINGLE ? "/condominio" : "/login"; }

// ===================================================================
// MFA / 2FA (TOTP)
// ===================================================================
async function mfaPendente(){
  try{ const {data}=await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    return !!data && data.currentLevel==="aal1" && data.nextLevel==="aal2"; }
  catch(_){ return false; }
}
async function showMfaChallenge(){
  showScreen("auth");
  let factorId=null;
  try{ const {data}=await sb.auth.mfa.listFactors(); factorId=(data?.totp||[]).find(f=>f.status==="verified")?.id; }catch(_){}
  if(!factorId){ /* fallback: sem fator verificado, entra normal */ const {data:{user}}=await sb.auth.getUser(); if(user){ S.user=user; } await bootAfterMfa(); return; }
  sheet(`<h2>Verificação em duas etapas</h2><p class="sub">Digite o código de 6 dígitos do seu app autenticador.</p>
    <input id="mfaCode" class="field" inputmode="numeric" maxlength="6" placeholder="000000" style="font-size:24px;letter-spacing:8px;text-align:center">
    <div id="mfaErr" class="err"></div>
    <button class="btn" id="mfaBtn">Confirmar</button>
    <button class="btn ghost" id="mfaSair">Sair</button>`);
  const submit=async()=>{
    const code=$("#mfaCode").value.trim(); if(code.length<6) return;
    $("#mfaBtn").disabled=true; $("#mfaErr").classList.remove("show");
    try{
      const {data:ch,error:e1}=await sb.auth.mfa.challenge({factorId}); if(e1) throw e1;
      const {error:e2}=await sb.auth.mfa.verify({factorId,challengeId:ch.id,code}); if(e2) throw e2;
      closeSheet(); await bootAfterMfa();
    }catch(_){ $("#mfaBtn").disabled=false; const e=$("#mfaErr"); e.textContent="Código inválido. Tente de novo."; e.classList.add("show"); }
  };
  $("#mfaBtn").addEventListener("click",submit);
  $("#mfaCode").addEventListener("keydown",e=>{ if(e.key==="Enter") submit(); });
  $("#mfaSair").addEventListener("click",logout);
}
// re-entra no boot já com AAL2 (sem re-checar MFA e cair em loop)
async function bootAfterMfa(){
  const {data:{user}}=await sb.auth.getUser(); if(!user){ if(APP_ROLE){ location.href="/login"; return; } showScreen("auth"); return; }
  S.user=user;
  try{ await rpc("convites_aceitar"); }catch(_){}
  const {data:ms}=await sb.from("memberships").select("id,role,condominio_id,unidade_id,condominios(nome,cidade,uf)").eq("user_id",user.id).eq("ativo",true);
  S.memberships=ms||[];
  routeAfterAuth();
}
async function ativarMFA(){
  try{
    const {data:f}=await sb.auth.mfa.listFactors();
    for(const x of (f?.all||[])) if(x.factor_type==="totp" && x.status!=="verified"){ try{ await sb.auth.mfa.unenroll({factorId:x.id}); }catch(_){} }
    const {data,error}=await sb.auth.mfa.enroll({factorType:"totp",friendlyName:"CondoApp "+Date.now()});
    if(error) throw error;
    const factorId=data.id, qr=data.totp.qr_code, secret=data.totp.secret;
    sheet(`<h2>Ativar 2FA</h2><p class="sub">Escaneie o QR no Google Authenticator, Authy ou similar e digite o código gerado.</p>
      <div style="display:flex;justify-content:center;margin:10px 0"><img src="${qr.replace(/"/g,"&quot;")}" alt="QR" style="width:200px;height:200px;background:#fff;border-radius:12px"></div>
      <p class="sub" style="text-align:center;word-break:break-all">ou digite a chave manualmente:<br><b id="mfSecret">${esc(secret)}</b></p>
      <label>Código do app</label><input id="mfCode" class="field" inputmode="numeric" maxlength="6" placeholder="000000" style="font-size:22px;letter-spacing:8px;text-align:center">
      <div id="mfErr" class="err"></div>
      <button class="btn" id="mfVer">Ativar 2FA</button>`);
    $("#mfVer").addEventListener("click",async()=>{
      const code=$("#mfCode").value.trim(); if(code.length<6) return;
      $("#mfVer").disabled=true; $("#mfErr").classList.remove("show");
      try{
        const {data:ch,error:e1}=await sb.auth.mfa.challenge({factorId}); if(e1) throw e1;
        const {error:e2}=await sb.auth.mfa.verify({factorId,challengeId:ch.id,code}); if(e2) throw e2;
        closeSheet(); toast("2FA ativado 🔐"); renderPerfil();
      }catch(_){ $("#mfVer").disabled=false; const e=$("#mfErr"); e.textContent="Código inválido."; e.classList.add("show"); }
    });
  }catch(e){ toast(e.message||"Falha ao ativar 2FA"); }
}
async function desativarMFA(){
  if(!(await confirmar("Desativar a verificação em duas etapas?","Desativar"))) return;
  try{
    const {data:f}=await sb.auth.mfa.listFactors();
    for(const x of (f?.all||[])) if(x.factor_type==="totp"){ try{ await sb.auth.mfa.unenroll({factorId:x.id}); }catch(_){} }
    toast("2FA desativado"); renderPerfil();
  }catch(e){ toast(e.message||"Falha ao desativar"); }
}

// ===================================================================
// NAV / ROTEAMENTO
// ===================================================================
function buildNav(){
  const nav=$("#nav"); const tabs=tabsFor(S.role);
  nav.innerHTML=tabs.map(t=>`<button data-tab="${t.id}" title="${t.label}"><span class="ic">${t.ic}</span><span class="lbl">${t.label}</span></button>`).join("");
  nav.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.tab)));
}
function setActive(tab){
  const nav = HUB_TABS.includes(tab) ? "servicos" : tab;
  document.querySelectorAll("#nav [data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===nav));
}
window.addEventListener("hashchange",()=>{ if(!$("#app").classList.contains("hide")) go(location.hash.replace("#","")||"inicio",true); });
function go(tab,fromHash){
  S.tab=tab; if(location.hash.replace("#","")!==tab && !fromHash) location.hash=tab;
  setActive(tab); $("#fab").classList.add("hide");
  const R={inicio:renderComunicados,ocorrencias:renderOcorrencias,portaria:renderPortaria,encomendas:renderEncomendas,
           servicos:renderServicos,reservas:renderReservas,financeiro:renderFinanceiro,assembleias:renderAssembleias,
           enquetes:renderEnquetes,manutencoes:renderManutencoes,mural:renderMural,livro:renderLivroPortaria,
           documentos:renderDocumentos,gestao:renderGestao,atendimento:renderAtendimento,contas:renderPrestacaoContas,perfil:renderPerfil,
           cadastros:renderCadastros,vagas:renderVagas,autorizacoes:renderAutorizacoes,conversas:renderConversas,pesquisas:renderPesquisas,
           consumo:renderConsumo,painel:renderPainel,sos:renderSOS};
  (R[tab]||renderComunicados)();
}

// ===================================================================
// MÓDULO: CONSUMO (água / gás / energia) individualizado por unidade
// ===================================================================
const CONS_TIPO={agua:{ic:"💧",nome:"Água",un:"m³"},gas:{ic:"🔥",nome:"Gás",un:"m³"},energia:{ic:"⚡",nome:"Energia",un:"kWh"}};
let _consTipo="agua";
// fmtNum, compLabel: em ./helpers.js
async function renderConsumo(){
  view().innerHTML=subhead('Consumo <small>Água, gás e energia por unidade</small>')+'<div class="spin"></div>';
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#fab").classList.add("hide");
  const gestor=isGestor(S.role)||isPortaria(S.role);
  const [{data:unids},{data:leituras}]=await Promise.all([
    sb.from("unidades").select("id,bloco,numero").eq("condominio_id",S.condId).order("numero"),
    sb.from("leituras").select("*").eq("condominio_id",S.condId).order("competencia",{ascending:false}).order("created_at",{ascending:false})
  ]);
  S._consUnids=unids||[];
  const unMap={}; (unids||[]).forEach(u=>unMap[u.id]=unitLabel(u.bloco,u.numero));
  const t=_consTipo, meta=CONS_TIPO[t];
  const rows=(leituras||[]).filter(l=>l.tipo===t);

  let html=subhead('Consumo <small>Água, gás e energia por unidade</small>');
  html+=`<div class="seg" id="consTabs" style="margin:0 2px 12px">`
    +Object.entries(CONS_TIPO).map(([k,v])=>`<button data-ct="${k}" class="${k===t?"on":""}">${v.ic} ${v.nome}</button>`).join("")+`</div>`;
  if(gestor) html+=`<button class="btn secondary" id="consAdd" style="margin:0 0 12px">＋ Lançar leitura</button>`;

  if(S.unidadeId && !gestor){
    // MORADOR: apenas a própria unidade — mini-gráfico + histórico
    const mine=rows.filter(l=>l.unidade_id===S.unidadeId);
    if(!mine.length){
      html+=emptyBox(meta.ic,"Sem leituras ainda","Quando o síndico lançar a leitura de "+meta.nome.toLowerCase()+", seu histórico aparece aqui.");
    }else{
      const asc=mine.slice().sort((a,b)=>a.competencia<b.competencia?-1:1).slice(-8);
      const max=Math.max(1,...asc.map(l=>Number(l.consumo)||0));
      html+=`<div class="chartcard"><div class="ct">${meta.ic} Consumo de ${meta.nome} (${meta.un})</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:140px">`
        +asc.map(l=>{ const c=Number(l.consumo)||0; const h=c>0?Math.max(6,Math.round((c/max)*100)):0;
          return `<div style="flex:1;height:100%;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0">
            <div style="font-size:10px;color:var(--muted)">${l.consumo==null?"":fmtNum(l.consumo)}</div>
            <div style="flex:1;width:70%;display:flex;align-items:flex-end">
              <div title="${fmtNum(l.consumo)}" style="width:100%;background:var(--brand);border-radius:5px 5px 0 0;height:${h}%"></div></div>
            <div style="font-size:10px;color:var(--muted)">${compLabel(l.competencia)}</div></div>`; }).join("")
        +`</div></div>`;
      html+=`<label>Histórico</label>`;
      html+=mine.map(l=>`<div class="tile" style="padding:12px 14px">
        <div class="row"><h3 style="flex:1;font-size:15px">${meta.ic} ${compLabel(l.competencia)} — ${fmtNum(l.consumo)} ${meta.un}</h3>
          ${l.valor!=null?`<span class="badge">${fmtMoney(l.valor)}</span>`:""}</div>
        <div class="meta"><span>Anterior ${fmtNum(l.leitura_anterior)}</span><span>Atual ${fmtNum(l.leitura_atual)}</span>
          ${l.cobranca_id?`<span>🧾 no financeiro</span>`:""}</div>
        ${l.observacao?`<p style="margin-top:6px">${esc(l.observacao)}</p>`:""}</div>`).join("");
    }
  }else{
    // GESTÃO/PORTARIA: todas as unidades
    if(!rows.length){
      html+=emptyBox(meta.ic,"Nenhuma leitura de "+meta.nome.toLowerCase(),gestor?"Toque em “Lançar leitura” para começar.":"");
    }else{
      html+=rows.map(l=>`<div class="tile" style="padding:12px 14px">
        <div class="row"><h3 style="flex:1;font-size:15px">🏠 ${esc(unMap[l.unidade_id]||"—")} · ${compLabel(l.competencia)}</h3>
          <span class="badge">${fmtNum(l.consumo)} ${meta.un}</span></div>
        <div class="meta"><span>Anterior ${fmtNum(l.leitura_anterior)}</span><span>Atual ${fmtNum(l.leitura_atual)}</span>
          ${l.valor!=null?`<span>💰 ${fmtMoney(l.valor)}</span>`:""}${l.cobranca_id?`<span>🧾 no financeiro</span>`:""}</div>
        ${l.observacao?`<p style="margin-top:6px">${esc(l.observacao)}</p>`:""}
        <div class="meta">
          ${isSindico(S.role)&&l.valor!=null&&!l.cobranca_id?`<button class="badge" data-lcob="${l.id}" style="cursor:pointer">🧾 Gerar cobrança</button>`:""}
          <button class="badge cancelada" data-ldel="${l.id}" style="cursor:pointer">🗑️ Excluir</button></div></div>`).join("");
    }
  }
  view().innerHTML=html;
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  view().querySelectorAll("[data-ct]").forEach(b=>b.addEventListener("click",()=>{ _consTipo=b.dataset.ct; renderConsumo(); }));
  $("#consAdd")?.addEventListener("click",lancarLeitura);
  view().querySelectorAll("[data-ldel]").forEach(b=>b.addEventListener("click",async()=>{
    if(!await confirmar("Excluir esta leitura?","Excluir")) return;
    try{ await rpc("leitura_excluir",{p_id:b.dataset.ldel}); toast("Leitura excluída"); renderConsumo(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-lcob]").forEach(b=>b.addEventListener("click",()=>gerarCobrancaLeitura(b.dataset.lcob)));
}
function lancarLeitura(){
  const unids=S._consUnids||[];
  if(!unids.length) return toast("Cadastre unidades antes.");
  let tipo=_consTipo;
  const now=new Date(); const comp=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
  sheet(`<h2>Lançar leitura</h2>
    <label>Tipo</label><div class="seg" id="ltTipo">`
      +Object.entries(CONS_TIPO).map(([k,v])=>`<button data-t="${k}" class="${k===tipo?"on":""}">${v.ic} ${v.nome}</button>`).join("")+`</div>
    <label>Unidade</label><select id="ltUnid" class="field">`
      +unids.map(u=>`<option value="${u.id}">${esc(unitLabel(u.bloco,u.numero))}</option>`).join("")+`</select>
    <label>Competência</label><input id="ltComp" class="field" type="month" value="${comp}">
    <label>Leitura atual (<span id="ltUn">${CONS_TIPO[tipo].un}</span>)</label>
    <input id="ltAtual" class="field" type="number" inputmode="decimal" step="0.001" placeholder="Ex.: 1234.5">
    <label>Valor por <span id="ltUn2">${CONS_TIPO[tipo].un}</span> (opcional)</label>
    <input id="ltVu" class="field" type="number" inputmode="decimal" step="0.01" placeholder="Ex.: 9.90">
    <label>Observação (opcional)</label><input id="ltObs" class="field" placeholder="Ex.: leitura estimada">
    <button class="btn" id="ltSave">Salvar leitura</button>`);
  $("#ltTipo").querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{
    tipo=b.dataset.t; $("#ltTipo").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
    $("#ltUn").textContent=CONS_TIPO[tipo].un; $("#ltUn2").textContent=CONS_TIPO[tipo].un;
  }));
  $("#ltSave").addEventListener("click",async()=>{
    const atual=$("#ltAtual").value.trim(); if(atual==="") return toast("Informe a leitura atual.");
    const comp2=$("#ltComp").value; if(!/^\d{4}-\d{2}$/.test(comp2)) return toast("Informe a competência.");
    const vu=$("#ltVu").value.trim();
    $("#ltSave").disabled=true;
    try{
      await rpc("leitura_registrar",{p_cond:S.condId,p_unidade:$("#ltUnid").value,p_tipo:tipo,
        p_competencia:comp2,p_leitura_atual:Number(atual),
        p_valor_unitario:vu===""?null:Number(vu),p_obs:$("#ltObs").value.trim()||null});
      _consTipo=tipo; closeSheet(); toast("Leitura salva 💧"); renderConsumo();
    }catch(e){ $("#ltSave").disabled=false; toast(e.message); }
  });
}
async function gerarCobrancaLeitura(id){
  const now=new Date(); const venc=new Date(now.getFullYear(),now.getMonth(),Math.min(10,28));
  const def=venc.toISOString().slice(0,10);
  sheet(`<h2>Gerar cobrança</h2><p class="sub" style="margin:2px 0 4px">Cria uma cobrança no Financeiro com o valor do consumo. O morador é notificado.</p>
    <label>Vencimento</label><input id="lcVenc" class="field" type="date" value="${def}">
    <button class="btn" id="lcSave">Gerar cobrança</button>`);
  $("#lcSave").addEventListener("click",async()=>{
    const venc=$("#lcVenc").value; if(!venc) return toast("Informe o vencimento.");
    $("#lcSave").disabled=true;
    try{ await rpc("leitura_cobranca",{p_id:id,p_vencimento:venc}); closeSheet(); toast("Cobrança lançada 🧾"); renderConsumo(); }
    catch(e){ $("#lcSave").disabled=false; toast(e.message); }
  });
}

// ===================================================================
// NOTIFICAÇÕES (sino + painel)
// ===================================================================
let notifTimer=null;
async function refreshNotifBadge(){
  try{
    const {count}=await sb.from("notificacoes").select("id",{count:"exact",head:true}).eq("user_id",S.user.id).eq("lida",false);
    const dot=$("#notifDot");
    if(count&&count>0){ dot.textContent=count>99?"99+":count; dot.classList.remove("hide"); }
    else dot.classList.add("hide");
  }catch(_){}
}
// ---------- INTERFONE (morador recebe chamada da portaria) ----------
// Tempo real via Supabase Realtime (aviso instantâneo com o app aberto) +
// Web Push pela Edge Function (aparelho bloqueado). Poll lento só de segurança.
let interfoneTimer=null, interfoneChan=null, _chegShowing=null;
function pararInterfone(){
  if(interfoneTimer){ clearInterval(interfoneTimer); interfoneTimer=null; }
  if(interfoneChan){ try{ sb.removeChannel(interfoneChan); }catch(_){} interfoneChan=null; }
  if(typeof pararToque==="function") pararToque();
  _chegShowing=null;
}
function iniciarInterfone(){
  pararInterfone();
  if(!S.unidadeId) return;               // só quem tem unidade recebe interfone
  checarChegadas();                      // pega uma chamada que já esteja tocando
  // Realtime: dispara na hora que a portaria registra a chegada
  try{
    interfoneChan = sb.channel("interfone-"+S.unidadeId)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"chegadas",filter:"unidade_id=eq."+S.unidadeId},
        ({new:c})=>{ if(c && c.status==="tocando" && _chegShowing!==c.id){ _chegShowing=c.id; mostrarChamada(c); } })
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"chegadas",filter:"unidade_id=eq."+S.unidadeId},
        ({new:c})=>{ if(c && c.status!=="tocando" && _chegShowing===c.id){ _chegShowing=null; if($("#sheetBg").classList.contains("show")) closeSheet(); } })
      .subscribe();
  }catch(_){}
  // fallback lento (rede instável / realtime caiu)
  interfoneTimer=setInterval(checarChegadas,30000);
}
// ---------- PORTARIA/SÍNDICO: lista de chegadas atualiza sozinha ----------
// Quando o morador autoriza/nega (ou chega alguém novo), a tela da Portaria
// se atualiza na hora, sem precisar sair e voltar.
let chegadasChan=null, _chgLiveT=null;
function pararChegadasLive(){ if(chegadasChan){ try{ sb.removeChannel(chegadasChan); }catch(_){} chegadasChan=null; } clearTimeout(_chgLiveT); }
function iniciarChegadasLive(){
  pararChegadasLive();
  if(!S.condId || !isPortaria(S.role)) return;   // portaria / síndico / super_admin
  try{
    chegadasChan = sb.channel("chegadas-cond-"+S.condId)
      .on("postgres_changes",{event:"*",schema:"public",table:"chegadas",filter:"condominio_id=eq."+S.condId},
        ()=>{ clearTimeout(_chgLiveT); _chgLiveT=setTimeout(()=>{ if(S.tab==="portaria" && !$("#app").classList.contains("hide")) renderPortaria(); }, 250); })
      .subscribe();
  }catch(_){}
}
async function checarChegadas(){
  if(!S.unidadeId || $("#app").classList.contains("hide")) return;
  if($("#sheetBg").classList.contains("show")) return;   // não interromper outro fluxo
  try{
    const {data}=await sb.from("chegadas").select("*")
      .eq("condominio_id",S.condId).eq("unidade_id",S.unidadeId).eq("status","tocando")
      .order("created_at",{ascending:false}).limit(1);
    const c=(data||[])[0];
    if(!c){ _chegShowing=null; return; }
    if(_chegShowing===c.id) return;      // já está na tela
    _chegShowing=c.id; mostrarChamada(c);
  }catch(_){}
}
// bipe curto para chamar atenção (além da vibração)
function beepInterfone(){
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext; if(!Ctx) return;
    const ac=new Ctx();
    [0,0.35].forEach(t=>{
      const o=ac.createOscillator(), g=ac.createGain();
      o.type="sine"; o.frequency.value=880;
      o.connect(g); g.connect(ac.destination);
      const s=ac.currentTime+t;
      g.gain.setValueAtTime(0.001,s); g.gain.exponentialRampToValueAtTime(0.25,s+0.02);
      g.gain.exponentialRampToValueAtTime(0.001,s+0.25);
      o.start(s); o.stop(s+0.26);
    });
    setTimeout(()=>{ try{ ac.close(); }catch(_){} }, 900);
  }catch(_){}
}
// Toque contínuo: repete bipe+vibração enquanto a chamada está na tela (até ~45s)
let _ringTimer=null, _ringT0=0;
function pararToque(){ if(_ringTimer){ clearInterval(_ringTimer); _ringTimer=null; } try{ navigator.vibrate?.(0); }catch(_){} }
function iniciarToque(){
  pararToque(); _ringT0=Date.now();
  const pulse=()=>{
    if(Date.now()-_ringT0>45000){ pararToque(); return; }                 // para após ~45s
    if(!$("#sheetBg").classList.contains("show")){ pararToque(); return; } // a chamada saiu da tela
    try{ navigator.vibrate?.([300,150,300]); }catch(_){}
    beepInterfone();
  };
  pulse();
  _ringTimer=setInterval(pulse,2600);
}
// ---------- Relógio ao vivo do interfone ("Tocando… m:ss") ----------
// Um único setInterval atualiza todos os elementos .ringclock[data-since] na tela
// (cards da portaria + tela do morador). Para sozinho quando não há nenhum.
let _ringClockT=null;
function fmtRing(ms){ const s=Math.max(0,Math.floor(ms/1000)); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
function tickRingClocks(){
  const els=document.querySelectorAll(".ringclock[data-since]");
  if(!els.length){ if(_ringClockT){ clearInterval(_ringClockT); _ringClockT=null; } return; }
  const now=Date.now();
  els.forEach(el=>{ const t=Date.parse(el.getAttribute("data-since")); if(!isNaN(t)) el.textContent=fmtRing(now-t); });
}
function startRingClocks(){ tickRingClocks(); if(!_ringClockT) _ringClockT=setInterval(tickRingClocks,1000); }
function mostrarChamada(c){
  const TIPO={visita:"🚶 Visita",delivery:"🛵 Delivery",prestador:"🔧 Prestador",outro:"👤 Chegada"};
  iniciarToque();   // toca até atender/negar/fechar
  sheet(`<h2 style="text-align:center">🔔 Chegada na portaria</h2>
    <div style="text-align:center;margin:8px 0 4px">
      <div style="font-size:44px">${(TIPO[c.tipo]||"👤 Chegada").split(" ")[0]}</div>
      <div style="font-size:20px;font-weight:800;margin-top:6px">${esc(c.nome)}</div>
      <div class="sub" style="margin:6px 0 0">${(TIPO[c.tipo]||"Chegada").replace(/^\S+\s/,"")}${c.observacao?" · "+esc(c.observacao):""}</div>
      <div class="sub" style="margin:4px 0 0">🔔 tocando há <span class="ringclock" data-since="${c.created_at}">0:00</span></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn secondary" id="chNegar" style="flex:1;margin:0;background:#fdecea;color:var(--danger)">⛔ Negar</button>
      <button class="btn" id="chAutorizar" style="flex:1;margin:0">✅ Autorizar</button>
    </div>
    ${c.tipo==="delivery"?`<button class="btn secondary" id="chPortaria" style="margin-top:10px">📦 Deixar na portaria</button>`:""}`);
  startRingClocks();
  const btns=()=>["#chAutorizar","#chNegar","#chPortaria"].map($).filter(Boolean);
  const decidir=async(ok)=>{
    pararToque();
    btns().forEach(b=>b.disabled=true);
    try{ await rpc("chegada_decidir",{p_id:c.id,p_autorizar:ok,p_obs:null});
      closeSheet(); _chegShowing=null; toast(ok?"Entrada autorizada ✅":"Entrada negada ⛔"); refreshNotifBadge();
    }catch(e){ toast(e.message); btns().forEach(b=>b.disabled=false); }
  };
  $("#chAutorizar").addEventListener("click",()=>decidir(true));
  $("#chNegar").addEventListener("click",()=>decidir(false));
  $("#chPortaria")?.addEventListener("click",async()=>{
    pararToque(); btns().forEach(b=>b.disabled=true);
    try{ await rpc("chegada_deixar_portaria",{p_id:c.id,p_obs:null});
      closeSheet(); _chegShowing=null; toast("Delivery deixado na portaria 📦"); refreshNotifBadge();
    }catch(e){ toast(e.message); btns().forEach(b=>b.disabled=false); }
  });
}
async function openNotificacoes(){
  sheet('<h2>Notificações</h2><div class="spin"></div>');
  let list=[];
  try{ const {data}=await sb.from("notificacoes").select("*").eq("user_id",S.user.id).order("created_at",{ascending:false}).limit(40); list=data||[]; }
  catch(_){ $("#sheet").innerHTML='<div class="grab"></div><p class="empty">Erro ao carregar.</p>'; return; }
  const hasUnread=list.some(n=>!n.lida);
  let html=`<div class="row" style="align-items:center;margin-bottom:8px"><h2 style="flex:1;margin:0">Notificações</h2>
    ${hasUnread?'<button class="badge" id="notifAll">Marcar todas</button>':""}</div>`;
  if(!list.length){ html+=emptyBox("🔔","Nenhuma notificação.","Você será avisado aqui sobre comunicados, encomendas, reservas e mais."); }
  else html+=list.map(n=>`<button class="tile" data-notif="${n.id}" data-link="${esc(n.link||"")}" style="width:100%;text-align:left;display:block;${n.lida?"":"border-color:var(--brand)"}">
    <div class="row"><h3 style="flex:1;font-size:15px">${!n.lida?'<span class="unread"></span> ':""}${esc(n.titulo)}</h3><span class="sub" style="margin:0 0 0 8px;white-space:nowrap">${fmtDate(n.created_at)}</span></div>
    ${n.corpo?`<p style="margin-top:4px">${esc(n.corpo).replace(/\n/g,"<br>")}</p>`:""}</button>`).join("");
  $("#sheet").innerHTML='<div class="grab"></div>'+html;
  $("#notifAll")?.addEventListener("click",async()=>{ try{ await rpc("notif_marcar_todas"); }catch(_){} closeSheet(); refreshNotifBadge(); });
  $("#sheet").querySelectorAll("[data-notif]").forEach(b=>b.addEventListener("click",async()=>{
    const id=b.dataset.notif, link=b.dataset.link;
    try{ await rpc("notif_marcar_lida",{p_notif:id}); }catch(_){}
    closeSheet(); refreshNotifBadge();
    if(link) go(link.replace("#",""));
  }));
}
$("#bell")?.addEventListener("click",openNotificacoes);

// ===================================================================
// BUSCA GLOBAL (avisos / ocorrências / mural) + atalho "/"
// ===================================================================
let _bgTimer=null;
$("#search")?.addEventListener("click",buscaGlobal);
document.addEventListener("keydown",e=>{
  if(e.key==="/" && !/input|textarea|select/i.test(document.activeElement?.tagName||"")
     && !$("#app").classList.contains("hide") && !$("#sheetBg").classList.contains("show")){
    e.preventDefault(); buscaGlobal();
  }
});
// ---------- TEMA (claro/escuro) ----------
function currentTheme(){ return document.documentElement.getAttribute("data-theme")||"light"; }
function applyTheme(t){ document.documentElement.setAttribute("data-theme",t); try{ localStorage.setItem("vz-theme",t); }catch(_){}; const el=document.querySelector('meta[name=theme-color]'); if(el) el.content=t==="dark"?"#0d1f30":"#183451"; }
function toggleTheme(){ applyTheme(currentTheme()==="dark"?"light":"dark"); }
function buscaGlobal(){
  sheet(`<h2>🔍 Buscar</h2>
    <input id="bgInput" class="field" placeholder="Buscar em avisos, ocorrências, mural..." autocomplete="off">
    <div id="bgResults" style="margin-top:12px"><p class="sub">Digite ao menos 2 letras.</p></div>`);
  const inp=$("#bgInput"); setTimeout(()=>inp.focus(),100);
  inp.addEventListener("input",()=>{ clearTimeout(_bgTimer); _bgTimer=setTimeout(()=>bgDoSearch(inp.value.trim()),280); });
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ clearTimeout(_bgTimer); bgDoSearch(inp.value.trim()); } });
}
async function bgDoSearch(q){
  const el=$("#bgResults"); if(!el) return;
  if(q.length<2){ el.innerHTML='<p class="sub">Digite ao menos 2 letras.</p>'; return; }
  el.innerHTML='<div class="spin"></div>';
  const like='%'+q.replace(/[%(),]/g," ")+'%';
  try{
    const [com,oc,mu]=await Promise.all([
      sb.from("comunicados").select("id,titulo,corpo").eq("condominio_id",S.condId).or(`titulo.ilike.${like},corpo.ilike.${like}`).order("publicado_em",{ascending:false}).limit(6),
      sb.from("ocorrencias").select("id,titulo,descricao").eq("condominio_id",S.condId).or(`titulo.ilike.${like},descricao.ilike.${like}`).order("created_at",{ascending:false}).limit(6),
      sb.from("mural_posts").select("id,titulo,corpo").eq("condominio_id",S.condId).or(`titulo.ilike.${like},corpo.ilike.${like}`).order("created_at",{ascending:false}).limit(6)
    ]);
    const grupos=[
      {tab:"inicio", icon:"📣", nome:"Avisos", itens:(com.data||[]).map(x=>({t:x.titulo,s:x.corpo}))},
      {tab:"ocorrencias", icon:"🛠️", nome:"Ocorrências", itens:(oc.data||[]).map(x=>({t:x.titulo,s:x.descricao}))},
      {tab:"mural", icon:"🧷", nome:"Mural", itens:(mu.data||[]).map(x=>({t:x.titulo,s:x.corpo}))}
    ].filter(g=>g.itens.length);
    if(!grupos.length){ el.innerHTML=`<p class="empty">Nada encontrado para "${esc(q)}".</p>`; return; }
    el.innerHTML=grupos.map(g=>`<div class="h" style="font-size:14px;margin:10px 2px 6px">${g.icon} ${g.nome}</div>${g.itens.map(it=>`<button class="tile" data-goto-tab="${g.tab}" style="width:100%;text-align:left;margin-bottom:8px">
      <b>${esc(it.t)}</b>${it.s?`<p style="margin-top:4px;color:var(--muted);font-size:13px">${esc((it.s||"").slice(0,90))}</p>`:""}</button>`).join("")}`).join("");
    el.querySelectorAll("[data-goto-tab]").forEach(b=>b.addEventListener("click",()=>{ closeSheet(); go(b.dataset.gotoTab); }));
  }catch(e){ el.innerHTML=`<p class="empty">${esc(e.message)}</p>`; }
}

// ===================================================================
// MÓDULO: COMUNICADOS
// ===================================================================
async function renderComunicados(){
  loading();
  const lim=S._limComs||20;
  const {data:coms,error}=await sb.from("comunicados").select("*")
    .eq("condominio_id",S.condId).order("fixado",{ascending:false}).order("publicado_em",{ascending:false}).limit(lim);
  if(error){ view().innerHTML=`<p class="empty">Erro: ${esc(error.message)}</p>`; return; }
  const {data:reads}=await sb.from("comunicado_leituras").select("comunicado_id").eq("user_id",S.user.id);
  const readSet=new Set((reads||[]).map(r=>r.comunicado_id));
  const anexMap=await fetchAnexos("comunicado",(coms||[]).map(c=>c.id));

  const _nome=(S.user&&S.user.user_metadata&&S.user.user_metadata.nome)||(S.user&&S.user.email&&S.user.email.split("@")[0])||"";
  let html=`<div class="h">${_nome?`Olá, ${esc(_nome)} <small>Avisos do seu condomínio</small>`:`Avisos <small>Comunicados do seu condomínio</small>`}</div>`;
  // Banner de emergência: a emergência mais recente das últimas 24h
  const agora=Date.now();
  const emerg=(coms||[]).find(c=>c.prioridade==="emergencia" && (agora-new Date(c.publicado_em).getTime())<24*3600*1000);
  if(emerg){
    html+=`<div class="emerg-banner"><div class="row"><span style="font-size:22px">🚨</span>
      <div style="flex:1;min-width:0"><b>EMERGÊNCIA · ${esc(emerg.titulo)}</b>
      <p style="margin:4px 0 0">${esc(emerg.corpo).replace(/\n/g,"<br>")}</p>
      <small style="opacity:.8">🕒 ${fmtDate(emerg.publicado_em)}</small></div></div></div>`;
  }
  if(!coms || coms.length===0){
    html+=emptyBox("📭","Nenhum comunicado ainda.", isGestor(S.role)?"Toque em ＋ para publicar o primeiro.":"Você será avisado quando o síndico publicar.");
  } else {
    html+=coms.map(c=>{
      const unread=!readSet.has(c.id);
      const emg=c.prioridade==="emergencia";
      return `<div class="tile" data-com="${c.id}" ${emg?'style="border-color:var(--danger);border-width:1.5px"':""}>
        <div class="row">
          ${unread?'<span class="unread"></span>':""}
          <h3 style="flex:1">${c.fixado?'<span class="pin">📌 </span>':""}${esc(c.titulo)}</h3>
          ${emg?'<span class="badge emergencia">🚨 Emergência</span>':c.prioridade==="urgente"?'<span class="badge urgente">Urgente</span>':""}
        </div>
        <p>${esc(c.corpo).replace(/\n/g,"<br>")}</p>
        ${anexoThumbs(anexMap[c.id])}
        <div class="meta"><span>🕒 ${fmtDate(c.publicado_em)}</span>
          ${isGestor(S.role)&&c.alvo_tipo&&c.alvo_tipo!=="todos"?`<span class="badge">🎯 ${c.alvo_tipo==="bloco"?"Bloco "+esc(c.alvo_bloco||""):"1 unidade"}</span>`:""}
          ${isGestor(S.role)&&c.publicado_em&&new Date(c.publicado_em)>new Date()?`<span class="badge urgente">⏰ agendado</span>`:""}
          ${isGestor(S.role)?`<button class="badge" data-leram="${c.id}" style="margin-left:auto;cursor:pointer">👁️ Quem leu</button>`:""}
          ${isGestor(S.role)?`<button class="badge" data-del="${c.id}">Excluir</button>`:""}
        </div></div>`;
    }).join("");
    if(coms.length>=lim) html+=`<button class="btn secondary" id="comMais" style="margin-top:6px">Ver mais</button>`;
  }
  view().innerHTML=html;
  $("#comMais")?.addEventListener("click",()=>{ S._limComs=lim+20; renderComunicados(); });
  // marcar lido ao ver
  for(const c of (coms||[])) if(!readSet.has(c.id)){ rpc("com_marcar_lido",{p_comunicado:c.id}).catch(()=>{}); }
  view().querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async e=>{
    e.stopPropagation(); if(!(await confirmar("Excluir este comunicado?","Excluir"))) return;
    try{ await rpc("com_excluir",{p_comunicado:b.dataset.del}); toast("Excluído"); renderComunicados(); }catch(x){ toast(x.message); }
  }));
  view().querySelectorAll("[data-leram]").forEach(b=>b.addEventListener("click",async e=>{
    e.stopPropagation();
    sheet('<h2>Quem leu</h2><div class="spin"></div>');
    try{
      const r=await rpc("comunicado_leitores",{p_com:b.dataset.leram});
      const lidos=r.lidos||[]; const alvo=r.total_alvo||0; const pct=alvo?Math.round(lidos.length/alvo*100):0;
      sheet(`<h2>Quem leu</h2>
        <div class="tile" style="text-align:center"><b style="font-size:22px">${lidos.length} de ${alvo}</b><div class="sub">confirmaram leitura (${pct}%)</div></div>
        ${lidos.length?lidos.map(x=>`<div class="tile" style="padding:10px 14px"><div class="row"><span style="flex:1">👤 ${esc(x.nome)}</span><span class="sub" style="margin:0">${fmtDate(x.lido_em)}</span></div></div>`).join(""):'<p class="sub">Ninguém leu ainda.</p>'}`);
    }catch(x){ sheet('<h2>Quem leu</h2><p class="sub">'+esc(x.message||"Erro")+'</p>'); }
  }));
  if(isGestor(S.role)){ const f=$("#fab"); f.classList.remove("hide"); f.onclick=novoComunicado; }
}
async function novoComunicado(){
  let prio="normal", alvo="todos";
  const {data:unids}=await sb.from("unidades").select("id,bloco,numero").eq("condominio_id",S.condId).order("numero");
  const us=unids||[]; const blocos=[...new Set(us.map(u=>u.bloco).filter(Boolean))];
  sheet(`<h2>Novo comunicado</h2>
    <label>Título</label><input id="cTit" class="field" placeholder="Manutenção do elevador">
    <label>Mensagem</label><textarea id="cCorpo" class="field" rows="5" placeholder="Escreva o aviso..."></textarea>
    <label>Prioridade</label>
    <div class="seg" id="cPrio"><button data-p="normal" class="on">Normal</button><button data-p="urgente">Urgente</button><button data-p="emergencia">🚨 Emergência</button></div>
    <p class="sub" id="cPrioHint" style="margin:6px 2px 0;display:none">Emergência aparece em destaque no topo dos avisos e dispara notificação para todos.</p>
    <label style="margin-top:14px">Público</label>
    <div class="seg" id="cAlvo"><button data-a="todos" class="on">Todos</button>${blocos.length?`<button data-a="bloco">Por bloco</button>`:""}<button data-a="unidade">Por unidade</button></div>
    <div id="cAlvoBox" style="margin-top:8px"></div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px"><input type="checkbox" id="cPin"> Fixar no topo 📌</label>
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" id="cAgd"> Agendar publicação</label>
    <input id="cQuando" class="field hide" type="datetime-local" style="margin-top:8px">
    <label style="margin-top:10px">Anexos (opcional)</label><input id="cArq" class="field" type="file" accept="image/*,.pdf" multiple>
    <button class="btn" id="cSave">Publicar</button>`);
  const drawAlvo=()=>{
    const box=$("#cAlvoBox"); if(!box) return;
    if(alvo==="bloco") box.innerHTML=`<select id="cBloco" class="field">${blocos.map(b=>`<option value="${esc(b)}">Bloco ${esc(b)}</option>`).join("")}</select>`;
    else if(alvo==="unidade") box.innerHTML=`<select id="cUnid" class="field">${us.map(u=>`<option value="${u.id}">${esc(unitLabel(u.bloco,u.numero))}</option>`).join("")}</select>`;
    else box.innerHTML="";
  };
  $("#cPrio").querySelectorAll("[data-p]").forEach(b=>b.addEventListener("click",()=>{
    prio=b.dataset.p; $("#cPrio").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
    $("#cPrioHint").style.display = prio==="emergencia" ? "block" : "none";
  }));
  $("#cAlvo").querySelectorAll("[data-a]").forEach(b=>b.addEventListener("click",()=>{ alvo=b.dataset.a; $("#cAlvo").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); drawAlvo(); }));
  $("#cAgd").addEventListener("change",e=>{ $("#cQuando").classList.toggle("hide",!e.target.checked); });
  drawAlvo();
  $("#cSave").addEventListener("click",async()=>{
    const t=$("#cTit").value.trim(), c=$("#cCorpo").value.trim();
    if(!t||!c) return toast("Preencha título e mensagem.");
    let alvoBloco=null, alvoUnidade=null;
    if(alvo==="bloco"){ alvoBloco=$("#cBloco")?.value||null; if(!alvoBloco) return toast("Escolha o bloco."); }
    if(alvo==="unidade"){ alvoUnidade=$("#cUnid")?.value||null; if(!alvoUnidade) return toast("Escolha a unidade."); }
    let quando=null;
    if($("#cAgd").checked){ const v=$("#cQuando").value; if(!v) return toast("Defina a data/hora do agendamento."); quando=new Date(v).toISOString(); }
    $("#cSave").disabled=true;
    try{ const id=await rpc("com_publicar",{p_cond:S.condId,p_titulo:t,p_corpo:c,p_prioridade:prio,p_fixado:$("#cPin").checked,p_alvo_tipo:alvo,p_alvo_bloco:alvoBloco,p_alvo_unidade:alvoUnidade,p_publicar_em:quando});
      const files=$("#cArq").files; if(files&&files.length){ toast("Enviando anexos..."); await uploadAnexos("comunicado",id,files); }
      closeSheet(); toast(quando?"Comunicado agendado ⏰":"Publicado 📣"); renderComunicados();
    }catch(e){ $("#cSave").disabled=false; toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: OCORRÊNCIAS
// ===================================================================
async function renderOcorrencias(){
  loading();
  const lim=S._limOcs||20;
  const {data:ocs,error}=await sb.from("ocorrencias").select("*")
    .eq("condominio_id",S.condId).order("created_at",{ascending:false}).limit(lim);
  if(error){ view().innerHTML=`<p class="empty">Erro: ${esc(error.message)}</p>`; return; }
  let html=`<div class="h">Ocorrências <small>${isGestor(S.role)?"Chamados do condomínio":"Seus chamados e avisos do prédio"}</small></div>`;
  if(!ocs||ocs.length===0){
    html+=emptyBox("✅","Nenhuma ocorrência aberta.","Toque em ＋ para registrar um chamado.");
  }else{
    html+=ocs.map(o=>`<div class="tile" data-oc="${o.id}" style="cursor:pointer">
      <div class="row"><h3 style="flex:1">${esc(o.titulo)}</h3><span class="badge ${o.status}">${OC_STATUS[o.status]}</span></div>
      <p>${esc(o.descricao).slice(0,120)}${o.descricao.length>120?"…":""}</p>
      <div class="meta"><span>🏷️ ${OC_CAT[o.categoria]||o.categoria}</span><span>🕒 ${fmtDate(o.created_at)}</span></div>
    </div>`).join("");
    if(ocs.length>=lim) html+=`<button class="btn secondary" id="ocMais" style="margin-top:6px">Ver mais</button>`;
  }
  view().innerHTML=html;
  $("#ocMais")?.addEventListener("click",()=>{ S._limOcs=lim+20; renderOcorrencias(); });
  view().querySelectorAll("[data-oc]").forEach(b=>b.addEventListener("click",()=>detalheOcorrencia(b.dataset.oc)));
  const f=$("#fab"); f.classList.remove("hide"); f.onclick=novaOcorrencia;
}
function novaOcorrencia(){
  let cat="manutencao";
  const cats=Object.entries(OC_CAT).map(([k,v])=>`<button data-c="${k}" class="${k==="manutencao"?"on":""}">${v}</button>`).join("");
  sheet(`<h2>Nova ocorrência</h2>
    <label>Categoria</label><div class="seg" id="oCat">${cats}</div>
    <label>Título</label><input id="oTit" class="field" placeholder="Lâmpada queimada no hall">
    <label>Descrição</label><textarea id="oDesc" class="field" rows="4" placeholder="Detalhe o que aconteceu..."></textarea>
    <label>Fotos / anexos (opcional)</label><input id="oArq" class="field" type="file" accept="image/*,.pdf" multiple>
    <button class="btn" id="oSave">Registrar</button>`);
  $("#oCat").querySelectorAll("[data-c]").forEach(b=>b.addEventListener("click",()=>{
    cat=b.dataset.c; $("#oCat").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
  }));
  $("#oSave").addEventListener("click",async()=>{
    const t=$("#oTit").value.trim(), d=$("#oDesc").value.trim();
    if(!t||!d) return toast("Preencha título e descrição.");
    $("#oSave").disabled=true;
    try{ const id=await rpc("oc_abrir",{p_cond:S.condId,p_titulo:t,p_descricao:d,p_categoria:cat,p_unidade:S.unidadeId});
      const files=$("#oArq").files; if(files&&files.length){ toast("Enviando anexos..."); await uploadAnexos("ocorrencia",id,files); }
      closeSheet(); toast("Ocorrência registrada 🛠️"); renderOcorrencias();
    }catch(e){ $("#oSave").disabled=false; toast(e.message); }
  });
}
async function detalheOcorrencia(id){
  const {data:o}=await sb.from("ocorrencias").select("*").eq("id",id).single();
  const {data:ups}=await sb.from("ocorrencia_updates").select("*").eq("ocorrencia_id",id).order("created_at");
  const anexMap=await fetchAnexos("ocorrencia",[id]); const anex=anexMap[id]||[];
  const gestor=isGestor(S.role)||S.role==="portaria";
  const timeline=(ups||[]).map(u=>`<div class="tile" style="margin:8px 0;padding:12px">
    ${u.novo_status?`<span class="badge ${u.novo_status}">${OC_STATUS[u.novo_status]}</span> `:""}
    ${u.corpo?esc(u.corpo):""}<div class="meta"><span>🕒 ${fmtDate(u.created_at)}</span></div></div>`).join("")||'<p class="sub">Sem atualizações ainda.</p>';
  const stBtns=gestor?["aberta","em_andamento","resolvida","cancelada"].map(st=>
    `<button data-st="${st}" class="${st===o.status?"on":""}">${OC_STATUS[st]}</button>`).join(""):"";
  sheet(`<h2>${esc(o.titulo)}</h2>
    <div class="meta"><span class="badge ${o.status}">${OC_STATUS[o.status]}</span><span>🏷️ ${OC_CAT[o.categoria]}</span><span>🕒 ${fmtDate(o.created_at)}</span></div>
    <p style="margin:12px 0;line-height:1.55">${esc(o.descricao).replace(/\n/g,"<br>")}</p>
    ${anexoThumbs(anex)}
    ${gestor?`<label style="margin-top:14px">Alterar status</label><div class="seg" id="ocSt">${stBtns}</div>`:""}
    <label>Comentário</label><textarea id="ocMsg" class="field" rows="2" placeholder="Adicionar atualização..."></textarea>
    <button class="btn" id="ocSend">Enviar</button>
    <label style="margin-top:14px">Adicionar foto/anexo</label><input id="ocArq" class="field" type="file" accept="image/*,.pdf" multiple>
    <button class="btn secondary" id="ocAddAnexo">Enviar anexo</button>
    <label style="margin-top:18px">Histórico</label>${timeline}`);
  $("#ocAddAnexo").addEventListener("click",async()=>{
    const files=$("#ocArq").files; if(!files||!files.length) return toast("Escolha um arquivo.");
    $("#ocAddAnexo").disabled=true;
    try{ await uploadAnexos("ocorrencia",id,files); toast("Anexo enviado 📎"); detalheOcorrencia(id); }
    catch(e){ $("#ocAddAnexo").disabled=false; toast(e.message); }
  });
  let novoStatus=null;
  $("#ocSt")?.querySelectorAll("[data-st]").forEach(b=>b.addEventListener("click",()=>{
    novoStatus=b.dataset.st; $("#ocSt").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
  }));
  $("#ocSend").addEventListener("click",async()=>{
    const msg=$("#ocMsg").value.trim();
    if(!msg && !novoStatus) return toast("Escreva algo ou mude o status.");
    try{ await rpc("oc_atualizar",{p_ocorrencia:id,p_corpo:msg||null,p_novo_status:novoStatus});
      closeSheet(); toast("Atualizado"); renderOcorrencias();
    }catch(e){ toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: ENCOMENDAS (visão morador)
// ===================================================================
async function renderEncomendas(){
  loading();
  const {data:enc,error}=await sb.from("encomendas").select("*")
    .eq("condominio_id",S.condId).order("created_at",{ascending:false});
  if(error){ view().innerHTML=`<p class="empty">Erro: ${esc(error.message)}</p>`; return; }
  let html=`<div class="h">Encomendas <small>Entregas na portaria para sua unidade</small></div>`;
  const pend=(enc||[]).filter(e=>e.status==="recebida");
  if(pend.length) html+=`<div class="tile" style="background:#fdfce4;border-color:#ece79a"><b>📦 ${pend.length} encomenda(s) aguardando retirada</b></div>`;
  if(!enc||enc.length===0){
    html+=emptyBox("📭","Nenhuma encomenda registrada.","Quando a portaria receber algo para você, aparece aqui.");
  }else{
    const anexMap=await fetchAnexos("encomenda",enc.map(e=>e.id));
    html+=enc.map(e=>encCard(e,false,anexMap[e.id])).join("");
  }
  view().innerHTML=html;
}
function encCard(e,portaria,anexos){
  return `<div class="tile">
    <div class="row"><h3 style="flex:1">${esc(e.remetente||"Encomenda")}</h3><span class="badge ${e.status}">${e.status==="recebida"?"Aguardando":"Retirada"}</span></div>
    ${e.descricao?`<p>${esc(e.descricao)}</p>`:""}
    ${anexos&&anexos.length?anexoThumbs(anexos):""}
    <div class="meta">${e.codigo_rastreio?`<span>🔖 ${esc(e.codigo_rastreio)}</span>`:""}<span>🕒 ${fmtDate(e.created_at)}</span>
    ${e.status==="retirada"?`<span>✅ ${esc(e.retirada_por||"")} · ${fmtDate(e.retirada_em)}</span>`:""}</div>
    ${portaria && e.status==="recebida"?`<button class="btn" data-retirar="${e.id}" style="margin-top:12px">Registrar retirada</button>`:""}
  </div>`;
}

// ===================================================================
// MÓDULO: PORTARIA (encomendas + visitantes) — perfil portaria/gestão
// ===================================================================
async function renderPortaria(){
  loading();
  const [unids,enc,vis,cheg]=await Promise.all([
    sb.from("unidades").select("id,bloco,numero").eq("condominio_id",S.condId).order("numero"),
    sb.from("encomendas").select("*, unidades(bloco,numero)").eq("condominio_id",S.condId).order("created_at",{ascending:false}),
    sb.from("visitantes").select("*, unidades(bloco,numero)").eq("condominio_id",S.condId).order("created_at",{ascending:false}),
    sb.from("chegadas").select("*, unidades(bloco,numero)").eq("condominio_id",S.condId).order("created_at",{ascending:false}).limit(20)
  ]);
  S._unids=unids.data||[];
  const encs=enc.data||[], viss=vis.data||[], chegs=cheg.data||[];
  const pend=encs.filter(e=>e.status==="recebida").length;
  const {data:sosAtivos}=await sb.from("sos_alertas").select("*, unidades(bloco,numero)").eq("condominio_id",S.condId).eq("status","ativo").order("created_at",{ascending:false});
  const CHEG_TIPO={visita:"🚶 Visita",delivery:"🛵 Delivery",prestador:"🔧 Prestador",outro:"👤 Outro"};
  const CHEG_ST={tocando:"Tocando…",autorizado:"Autorizado",negado:"Negado",expirado:"Expirado",cancelado:"Cancelado",na_portaria:"📦 Na portaria"};
  const CHEG_BADGE={tocando:"em_andamento",autorizado:"resolvida",negado:"cancelada",expirado:"cancelada",cancelado:"cancelada",na_portaria:"recebida"};
  let html=`<div class="h">Portaria <small>Interfone, encomendas e visitantes</small></div>
    <div class="seg" style="margin-bottom:14px">
      <button class="btn" id="pChegada" style="width:auto;margin:0;padding:11px 16px">🔔 Registrar chegada</button>
      <button class="btn secondary" id="pReceber" style="width:auto;margin:0;padding:11px 16px">📥 Registrar encomenda</button>
      <button class="btn secondary" id="pValidar" style="width:auto;margin:0;padding:11px 16px">🔑 Validar visitante</button>
      <button class="btn secondary" id="pAcesso" style="width:auto;margin:0;padding:11px 16px">🪪 Acesso morador</button>
      <button class="btn secondary" id="pPlaca" style="width:auto;margin:0;padding:11px 16px">🚗 Buscar placa</button>
      <button class="btn secondary" id="pLivro" style="width:auto;margin:0;padding:11px 16px">📒 Acessos</button>
    </div>`;
  // 🆘 SOS ativos — alerta de emergência no topo da portaria
  if(sosAtivos&&sosAtivos.length){
    html+=sosAtivos.map(a=>{
      const un=a.unidades?unitLabel(a.unidades.bloco,a.unidades.numero):"—";
      const map=(a.lat&&a.lng)?` · <a href="https://maps.google.com/?q=${a.lat},${a.lng}" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline">📍 mapa</a>`:"";
      return `<div class="emerg-banner"><b>${SOS_LABEL[a.tipo]||"🆘 Emergência"} — Un. ${esc(un)}</b>
        <div style="margin-top:4px;font-size:13px">${a.mensagem?esc(a.mensagem)+" · ":""}🕒 ${fmtDate(a.created_at)}${map}</div>
        <button class="btn" data-sosatende="${a.id}" style="margin-top:10px;background:#fff;color:var(--danger)">✅ Atender</button></div>`;
    }).join("");
  }
  // Interfone: mostra só as chegadas de HOJE (o histórico antigo fica em "Acessos")
  const _hoje=new Date(); _hoje.setHours(0,0,0,0);
  const chegsHoje=chegs.filter(c=>new Date(c.created_at)>=_hoje);
  const tocando=chegsHoje.filter(c=>c.status==="tocando");
  html+=`<label style="margin-top:4px">🔔 Interfone · hoje ${tocando.length?`· ${tocando.length} aguardando`:""}</label>`;
  html+= chegsHoje.length? chegsHoje.slice(0,12).map(c=>{
    const un=c.unidades?unitLabel(c.unidades.bloco,c.unidades.numero):"—";
    return `<div class="tile"><div class="row"><h3 style="flex:1;font-size:15px">🏠 ${esc(un)} — ${esc(c.nome)}</h3>
      <span class="badge ${CHEG_BADGE[c.status]}">${CHEG_ST[c.status]||c.status}${c.status==="tocando"?' <span class="ringclock" data-since="'+c.created_at+'">0:00</span>':""}</span></div>
      <div class="meta"><span>${CHEG_TIPO[c.tipo]||c.tipo}</span><span>🕒 ${fmtDate(c.created_at)}</span></div>
      ${c.status==="tocando"
        ? `<button class="btn secondary" data-cancelcheg="${c.id}" style="margin-top:10px">Cancelar chamada</button>`
        : `<button class="btn secondary" data-renovo="1" data-unid="${c.unidade_id}" data-nome="${esc(c.nome)}" data-tipo="${esc(c.tipo)}" data-obs="${esc(c.observacao||"")}" style="margin-top:10px">🔔 Tocar de novo</button>`}</div>`;
  }).join("") : '<p class="sub">Nenhuma chamada hoje.</p>';
  html+=`<label style="margin-top:4px">📦 Encomendas ${pend?`· ${pend} pendente(s)`:""}</label>`;
  html+= encs.length? encs.map(e=>{
    const un=e.unidades?`${e.unidades.bloco?e.unidades.bloco+" ":""}${e.unidades.numero}`:"—";
    return `<div class="tile"><div class="row"><h3 style="flex:1">🏠 ${esc(un)} — ${esc(e.remetente||"Encomenda")}</h3>
      <span class="badge ${e.status}">${e.status==="recebida"?"Aguardando":"Retirada"}</span></div>
      ${e.descricao?`<p>${esc(e.descricao)}</p>`:""}
      <div class="meta"><span>🕒 ${fmtDate(e.created_at)}</span>${e.status==="retirada"?`<span>✅ ${esc(e.retirada_por||"")}</span>`:""}</div>
      ${e.status==="recebida"?`<button class="btn" data-retirar="${e.id}" style="margin-top:10px">Registrar retirada</button>`:""}</div>`;
  }).join("") : '<p class="sub">Nenhuma encomenda.</p>';

  html+=`<label style="margin-top:16px">🚶 Visitantes autorizados</label>`;
  const ativos=viss.filter(v=>["autorizado","entrou"].includes(v.status));
  html+= ativos.length? ativos.map(v=>{
    const un=v.unidades?`${v.unidades.bloco?v.unidades.bloco+" ":""}${v.unidades.numero}`:"—";
    return `<div class="tile"><div class="row"><h3 style="flex:1">${esc(v.nome_visitante)}</h3><span class="badge ${v.status}">${v.status==="entrou"?"No prédio":"Autorizado"}</span></div>
      <div class="meta"><span>🏠 ${esc(un)}</span><span>🔑 ${esc(v.codigo)}</span>${v.documento?`<span>🪪 ${esc(v.documento)}</span>`:""}</div></div>`;
  }).join("") : '<p class="sub">Nenhum visitante ativo.</p>';

  view().innerHTML=html;
  $("#fab").classList.add("hide");
  startRingClocks();   // relógio ao vivo nas chamadas "tocando"
  view().querySelectorAll("[data-retirar]").forEach(b=>b.addEventListener("click",()=>retirarEncomenda(b.dataset.retirar)));
  view().querySelectorAll("[data-sosatende]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("sos_atender",{p_id:b.dataset.sosatende}); toast("SOS atendido ✅"); renderPortaria(); }catch(e){ toast(e.message); }
  }));
  $("#pReceber").addEventListener("click",registrarEncomenda);
  $("#pValidar").addEventListener("click",validarVisitante);
  $("#pPlaca").addEventListener("click",buscarPlaca);
  $("#pAcesso").addEventListener("click",validarAcessoMorador);
  $("#pLivro").addEventListener("click",verLivroAcesso);
  $("#pChegada").addEventListener("click",registrarChegada);
  view().querySelectorAll("[data-cancelcheg]").forEach(b=>b.addEventListener("click",async()=>{
    if(!await confirmar("Cancelar esta chamada de interfone?","Cancelar")) return;
    try{ await rpc("chegada_cancelar",{p_id:b.dataset.cancelcheg}); toast("Chamada cancelada"); renderPortaria(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-renovo]").forEach(b=>b.addEventListener("click",async()=>{
    b.disabled=true;
    try{ await rpc("chegada_registrar",{p_cond:S.condId,p_unidade:b.dataset.unid,p_nome:b.dataset.nome,p_tipo:b.dataset.tipo,p_obs:b.dataset.obs||null}); toast("Interfone tocando de novo 🔔"); renderPortaria(); }
    catch(e){ b.disabled=false; toast(e.message); }
  }));
}
function registrarChegada(){
  const unids=S._unids||[];
  if(!unids.length) return toast("Cadastre unidades antes.");
  let tipo="visita", selUnid=null;
  const tipos=[["visita","🚶 Visita"],["delivery","🛵 Delivery"],["prestador","🔧 Prestador"],["outro","👤 Outro"]]
    .map(([k,l])=>`<button data-t="${k}" class="${k==="visita"?"on":""}">${l}</button>`).join("");
  sheet(`<h2>Registrar chegada</h2><p class="sub" style="margin:2px 0 4px">O morador é avisado na hora e libera pelo app.</p>
    <label>Unidade</label>
    <input id="chBusca" class="field" placeholder="Buscar por bloco ou número" autocomplete="off" inputmode="search">
    <div id="chRecent" class="seg" style="margin-top:8px"></div>
    <div id="chLista" style="max-height:200px;overflow-y:auto;margin-top:8px;display:flex;flex-direction:column;gap:6px"></div>
    <label>Tipo</label><div class="seg" id="chTipo">${tipos}</div>
    <label>Quem chegou</label><input id="chNome" class="field" placeholder="Nome do visitante / entregador">
    <label>Observação (opcional)</label><input id="chObs" class="field" placeholder="Ex.: iFood, moto vermelha">
    <button class="btn" id="chSave">🔔 Tocar interfone</button>`);
  // unidades recentes (por condomínio) para acesso rápido
  const recKey="vz_cheg_rec_"+S.condId;
  let recents=[]; try{ recents=JSON.parse(localStorage.getItem(recKey)||"[]"); }catch(_){}
  const unitById=id=>unids.find(u=>u.id===id);
  const setSel=id=>{ selUnid=id; drawRecent(); drawLista($("#chBusca")?.value||""); };
  function drawRecent(){
    const el=$("#chRecent"); if(!el) return;
    const rs=recents.map(unitById).filter(Boolean).slice(0,5);
    el.innerHTML=rs.map(u=>`<button type="button" data-recu="${u.id}" class="${selUnid===u.id?"on":""}">🏠 ${esc(unitLabel(u.bloco,u.numero))}</button>`).join("");
    el.querySelectorAll("[data-recu]").forEach(b=>b.addEventListener("click",()=>setSel(b.dataset.recu)));
  }
  function drawLista(q){
    q=(q||"").trim().toLowerCase();
    const filt=q?unids.filter(u=>unitLabel(u.bloco,u.numero).toLowerCase().includes(q)):unids;
    const el=$("#chLista"); if(!el) return;
    el.innerHTML=filt.slice(0,60).map(u=>`<button type="button" data-u="${u.id}" class="btn secondary" style="margin:0;text-align:left;${selUnid===u.id?"outline:2px solid var(--brand);outline-offset:-2px":""}">🏠 ${esc(unitLabel(u.bloco,u.numero))}${selUnid===u.id?" ✓":""}</button>`).join("")
      || '<p class="sub" style="margin:6px 2px">Nenhuma unidade encontrada.</p>';
    el.querySelectorAll("[data-u]").forEach(b=>b.addEventListener("click",()=>setSel(b.dataset.u)));
  }
  drawRecent(); drawLista("");
  $("#chBusca").addEventListener("input",e=>drawLista(e.target.value));
  $("#chTipo").querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{ tipo=b.dataset.t; $("#chTipo").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); }));
  $("#chSave").addEventListener("click",async()=>{
    const nome=$("#chNome").value.trim(); if(!nome) return toast("Informe quem chegou.");
    if(!selUnid) return toast("Escolha a unidade.");
    $("#chSave").disabled=true;
    try{
      await rpc("chegada_registrar",{p_cond:S.condId,p_unidade:selUnid,p_nome:nome,p_tipo:tipo,p_obs:$("#chObs").value.trim()||null});
      recents=[selUnid,...recents.filter(x=>x!==selUnid)].slice(0,8);
      try{ localStorage.setItem(recKey,JSON.stringify(recents)); }catch(_){}
      closeSheet(); toast("Morador avisado 🔔"); renderPortaria();
    }catch(e){ $("#chSave").disabled=false; toast(e.message); }
  });
}
function buscarPlaca(){
  sheet(`<h2>Buscar placa</h2><p class="sub" style="margin:2px 0 4px">Identifique de qual unidade é o veículo.</p>
    <input id="bpPlaca" class="field" style="text-transform:uppercase;font-size:20px;letter-spacing:2px;text-align:center" maxlength="8" placeholder="ABC1D23">
    <button class="btn" id="bpGo">Buscar</button>
    <div id="bpRes" style="margin-top:14px"></div>`);
  const go=async()=>{
    const placa=$("#bpPlaca").value.trim(); if(!placa) return toast("Digite a placa.");
    $("#bpGo").disabled=true; $("#bpRes").innerHTML='<div class="spin"></div>';
    try{
      const rows=await rpc("portaria_buscar_placa",{p_cond:S.condId,p_placa:placa});
      if(!rows||!rows.length){ $("#bpRes").innerHTML='<p class="sub">Nenhum veículo com essa placa neste condomínio.</p>'; }
      else $("#bpRes").innerHTML=rows.map(r=>`<div class="tile" style="margin:0 0 10px">
        <div class="row"><h3 style="flex:1">${esc(r.placa)}</h3><span class="badge">${VEIC_TIPO[r.tipo]||r.tipo}</span></div>
        <div class="meta"><span>🏠 ${esc(unitLabel(r.bloco,r.numero))}</span>${r.modelo?`<span>${esc(r.modelo)}</span>`:""}${r.cor?`<span>🎨 ${esc(r.cor)}</span>`:""}${r.vaga?`<span>🅿️ ${esc(r.vaga)}</span>`:""}</div>
        ${r.moradores?`<div class="meta"><span>👤 ${esc(r.moradores)}</span></div>`:""}</div>`).join("");
    }catch(e){ $("#bpRes").innerHTML=`<p class="sub">${esc(e.message||"Erro na busca.")}</p>`; }
    $("#bpGo").disabled=false;
  };
  $("#bpGo").addEventListener("click",go);
  $("#bpPlaca").addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
}
function validarAcessoMorador(){
  sheet(`<h2>Acesso do morador</h2><p class="sub" style="margin:2px 0 4px">Leia o QR do morador (Perfil → Meu QR) ou digite o código.</p>
    <input id="amCod" class="field" style="text-transform:uppercase;font-size:20px;letter-spacing:3px;text-align:center" maxlength="8" placeholder="XXXXXXXX">
    <button class="btn secondary" id="amScan" style="margin-top:10px">📷 Escanear QR</button>
    <button class="btn" id="amGo">Validar</button>
    <div id="amRes" style="margin-top:14px"></div>`);
  const validar=async(codigo)=>{
    codigo=(codigo||$("#amCod").value).trim(); if(!codigo) return toast("Digite o código.");
    $("#amGo").disabled=true; $("#amRes").innerHTML='<div class="spin"></div>';
    try{
      const rows=await rpc("acesso_validar",{p_cond:S.condId,p_codigo:codigo});
      const r=(rows||[])[0];
      if(!r){ $("#amRes").innerHTML='<p class="sub">Código não encontrado.</p>'; }
      else{ $("#amRes").innerHTML=`<div class="tile" style="text-align:center;background:${r.ativo?"#e6f5ee":"#fdecea"}">
        <div style="font-size:34px">${r.ativo?"✅":"⛔"}</div>
        <h3 style="margin:6px 0 2px">${esc(r.nome)}</h3>
        <div class="meta" style="justify-content:center"><span>🏠 ${esc(unitLabel(r.bloco,r.numero))}</span><span>${r.ativo?"Acesso ativo":"Acesso bloqueado"}</span></div>
        <div class="seg" style="justify-content:center;margin-top:10px">
          <button class="btn" id="amEnt" style="width:auto;margin:0;padding:9px 16px">➡️ Entrada</button>
          <button class="btn secondary" id="amSai" style="width:auto;margin:0;padding:9px 16px">⬅️ Saída</button></div></div>`;
        const logar=async(tipo)=>{ try{ await rpc("acesso_log_registrar",{p_cond:S.condId,p_tipo:tipo,p_nome:r.nome,p_origem:"morador",p_unidade:null,p_obs:null}); toast(tipo==="entrada"?"Entrada registrada ➡️":"Saída registrada ⬅️"); closeSheet(); }catch(e){ toast(e.message); } };
        $("#amEnt").addEventListener("click",()=>logar("entrada"));
        $("#amSai").addEventListener("click",()=>logar("saida"));
      }
    }catch(e){ $("#amRes").innerHTML=`<p class="sub">${esc(e.message||"Erro.")}</p>`; }
    $("#amGo").disabled=false;
  };
  $("#amGo").addEventListener("click",()=>validar());
  $("#amCod").addEventListener("keydown",e=>{ if(e.key==="Enter") validar(); });
  $("#amScan").addEventListener("click",()=>abrirScannerQR(code=>{ const c=String(code).replace(/[^A-Za-z0-9]/g,"").toUpperCase().slice(0,8); $("#amCod").value=c; validar(c); }));
}
async function verLivroAcesso(){
  sheet('<h2>Livro de acesso</h2><div class="spin"></div>');
  const {data}=await sb.from("acessos_registros").select("*, unidades(bloco,numero)").eq("condominio_id",S.condId).order("created_at",{ascending:false}).limit(40);
  const ORIG={morador:"🪪",visitante:"🚶",manual:"✍️"};
  const list=(data||[]).map(r=>`<div class="tile" style="padding:11px 14px">
    <div class="row"><span style="font-size:17px">${r.tipo==="entrada"?"➡️":"⬅️"}</span>
      <h3 style="flex:1;font-size:15px">${esc(r.pessoa_nome)}</h3>
      <span class="badge ${r.tipo==="entrada"?"entrou":"saiu"}">${r.tipo==="entrada"?"Entrada":"Saída"}</span></div>
    <div class="meta"><span>${ORIG[r.origem]||""} ${r.origem}</span>${r.unidades?`<span>🏠 ${esc(unitLabel(r.unidades.bloco,r.unidades.numero))}</span>`:""}<span>🕒 ${fmtDate(r.created_at)}</span></div>
    ${r.observacao?`<p style="margin:6px 0 0;color:var(--muted);font-size:13px">${esc(r.observacao)}</p>`:""}</div>`).join("")
    || '<p class="sub">Nenhum registro ainda.</p>';
  sheet(`<h2>Livro de acesso</h2>
    <button class="btn secondary" id="laAdd" style="margin:0 0 12px">＋ Registrar manualmente</button>
    ${list}`);
  $("#laAdd").addEventListener("click",()=>{
    const unids=S._unids||[];
    let tipo="entrada";
    sheet(`<h2>Registrar acesso</h2>
      <label>Tipo</label><div class="seg" id="laTipo"><button data-t="entrada" class="on">➡️ Entrada</button><button data-t="saida">⬅️ Saída</button></div>
      <label>Nome</label><input id="laNome" class="field" placeholder="Nome da pessoa">
      <label>Unidade (opcional)</label><select id="laUnid" class="field"><option value="">—</option>${unids.map(u=>`<option value="${u.id}">${esc(unitLabel(u.bloco,u.numero))}</option>`).join("")}</select>
      <label>Observação (opcional)</label><input id="laObs" class="field" placeholder="Ex.: prestador de serviço">
      <button class="btn" id="laSave">Registrar</button>`);
    $("#laTipo").querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{ tipo=b.dataset.t; $("#laTipo").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); }));
    $("#laSave").addEventListener("click",async()=>{
      const nome=$("#laNome").value.trim(); if(!nome) return toast("Informe o nome.");
      try{ await rpc("acesso_log_registrar",{p_cond:S.condId,p_tipo:tipo,p_nome:nome,p_origem:"manual",p_unidade:$("#laUnid").value||null,p_obs:$("#laObs").value.trim()||null});
        toast("Registrado 📒"); verLivroAcesso();
      }catch(e){ toast(e.message); }
    });
  });
}
function unitOptions(){ return S._unids.map(u=>`<option value="${u.id}">${u.bloco?u.bloco+" ":""}${u.numero}</option>`).join(""); }
function registrarEncomenda(){
  if(!S._unids.length){ return toast("Cadastre unidades primeiro (Perfil → Unidades)."); }
  sheet(`<h2>Registrar encomenda</h2>
    <label>Unidade</label><select id="eUn" class="field">${unitOptions()}</select>
    <label>Remetente / transportadora</label><input id="eRem" class="field" placeholder="Correios, Amazon...">
    <label>Descrição (opcional)</label><input id="eDesc" class="field" placeholder="Caixa média">
    <label>Cód. rastreio (opcional)</label><input id="eRas" class="field" placeholder="BR123...">
    <label>Foto do pacote (opcional)</label><input id="eFoto" class="field" type="file" accept="image/*" capture="environment">
    <button class="btn" id="eSave">Registrar</button>`);
  $("#eSave").addEventListener("click",async()=>{
    $("#eSave").disabled=true;
    try{ const id=await rpc("enc_registrar",{p_cond:S.condId,p_unidade:$("#eUn").value,p_remetente:$("#eRem").value.trim()||null,p_descricao:$("#eDesc").value.trim()||null,p_rastreio:$("#eRas").value.trim()||null});
      const files=$("#eFoto").files; if(id&&files&&files.length){ toast("Enviando foto..."); await uploadAnexos("encomenda",id,files); }
      closeSheet(); toast("Encomenda registrada 📦. Morador notificado."); renderPortaria();
    }catch(e){ $("#eSave").disabled=false; toast(e.message); }
  });
}
async function retirarEncomenda(id){
  sheet(`<h2>Registrar retirada</h2><label>Quem retirou?</label>
    <input id="rNome" class="field" placeholder="Nome de quem retirou">
    <button class="btn" id="rSave">Confirmar retirada</button>`);
  $("#rSave").addEventListener("click",async()=>{
    const n=$("#rNome").value.trim(); if(!n) return toast("Informe o nome.");
    try{ await rpc("enc_retirar",{p_encomenda:id,p_retirada_por:n}); closeSheet(); toast("Retirada registrada ✅"); renderPortaria(); }catch(e){ toast(e.message); }
  });
}
function validarVisitante(){
  sheet(`<h2>Validar visitante</h2><p class="sub">Digite o código informado pelo morador.</p>
    <input id="vCod" class="field" style="text-transform:uppercase;font-size:22px;letter-spacing:4px;text-align:center" maxlength="6" placeholder="ABC123">
    <button class="btn secondary" id="vScan" style="margin-top:10px">📷 Escanear QR</button>
    <div class="seg" style="margin-top:14px"><button class="btn" id="vEnt" style="width:auto;margin:0">➡️ Entrada</button>
    <button class="btn secondary" id="vSai" style="width:auto;margin:0">⬅️ Saída</button></div>
    <div id="vRes"></div>`);
  $("#vScan").addEventListener("click",()=>abrirScannerQR(code=>{
    $("#vCod").value=String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
    toast("Código lido ✅ — confirme entrada ou saída.");
  }));
  async function act(acao){
    const cod=$("#vCod").value.trim(); if(!cod) return toast("Digite o código.");
    try{ const r=await rpc("vis_registrar",{p_cond:S.condId,p_codigo:cod,p_acao:acao});
      $("#vRes").innerHTML=`<div class="tile" style="margin-top:14px;background:#e6f5ee;border-color:#bfe6d1">
        <b>✅ ${esc(r.nome_visitante)}</b><p>${r.documento?"🪪 "+esc(r.documento)+" · ":""}${acao==="entrada"?"Entrada registrada":"Saída registrada"}</p></div>`;
      toast(acao==="entrada"?"Entrada liberada":"Saída registrada"); setTimeout(renderPortaria,900);
    }catch(e){ $("#vRes").innerHTML=`<div class="tile" style="margin-top:14px;background:#fdecea;border-color:#f3c0ba"><b>❌ ${esc(e.message)}</b></div>`; }
  }
  $("#vEnt").addEventListener("click",()=>act("entrada"));
  $("#vSai").addEventListener("click",()=>act("saida"));
}

// ===================================================================
// HUB: SERVIÇOS
// ===================================================================
// ===================================================================
// MÓDULO: ATENDIMENTO (tickets — canal condominio e plataforma)
// ===================================================================
const TK_CAT={geral:"Geral",financeiro:"Financeiro",tecnico:"Técnico",duvida:"Dúvida",sugestao:"Sugestão",reclamacao:"Reclamação",outro:"Outro"};
function fmtDT(iso){ return iso? new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : ""; }
function tkStatusBadge(s){
  const map={aberto:["#fff4e0","var(--warn)","Aberto"],em_andamento:["#e2eff2","#00596b","Em andamento"],resolvido:["#e6f5ee","var(--ok)","Resolvido"],fechado:["#f0f0f0","#888","Fechado"]};
  const [bg,c,l]=map[s]||map.aberto; return `<span class="badge" style="background:${bg};color:${c}">${l}</span>`;
}
function tkPrioBadge(p){
  const map={alta:["#fdecea","var(--danger)","Alta"],baixa:["#f0f0f0","#888","Baixa"]};
  const v=map[p]; return v?`<span class="badge" style="background:${v[0]};color:${v[1]}">${v[2]}</span>`:"";
}
async function signPaths(paths){
  if(!paths||!paths.length) return {};
  const {data}=await sb.storage.from("anexos").createSignedUrls(paths,3600);
  const map={}; (data||[]).forEach(s=>{ if(s.signedUrl) map[s.path]=s.signedUrl; }); return map;
}
async function renderAtendimento(){
  const gestor=isGestor(S.role);
  if(!(gestor && (S._tkSeg==="condominio"||S._tkSeg==="plataforma"))) S._tkSeg = gestor?"condominio":"meus";
  view().innerHTML=`<div class="subhead"><button class="back" data-goto="servicos">‹</button><div class="h" style="margin:0">🎧 Atendimento <small>Chamados e respostas</small></div></div>
    ${gestor?`<div class="seg" id="tkSeg" style="margin-bottom:12px">
      <button data-s="condominio" class="${S._tkSeg==="condominio"?"on":""}">Dos moradores</button>
      <button data-s="plataforma" class="${S._tkSeg==="plataforma"?"on":""}">Com a VIZELLO</button></div>`:""}
    <div id="tkList"><div class="spin"></div></div>`;
  view().querySelector("[data-goto]").addEventListener("click",()=>go("servicos"));
  if(gestor) $("#tkSeg").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ S._tkSeg=b.dataset.s; renderAtendimento(); }));
  const f=$("#fab");
  const canalNovo = gestor ? (S._tkSeg==="plataforma"?"plataforma":null) : "condominio";
  if(canalNovo){ f.classList.remove("hide"); f.onclick=()=>abrirTicket(canalNovo); } else f.classList.add("hide");
  const canalFiltro = gestor ? S._tkSeg : "condominio";
  let list=[];
  try{ list=await rpc("ticket_listar",{p_cond:S.condId,p_canal:canalFiltro}); }
  catch(e){ $("#tkList").innerHTML=`<p class="empty">${esc(e.message)}</p>`; return; }
  const el=$("#tkList");
  if(!list.length){ el.innerHTML=emptyBox("🎫","Nenhum chamado por aqui.", gestor&&S._tkSeg==="condominio"?"Os chamados dos moradores aparecem aqui.":"Toque em ＋ para abrir um chamado."); return; }
  el.innerHTML=list.map(t=>`<button class="tile" data-tk="${t.id}" style="width:100%;text-align:left">
    <div style="min-width:0">
      <h3 style="font-size:15px">${esc(t.assunto)}</h3>
      <div class="meta" style="margin-top:6px">${tkStatusBadge(t.status)}${tkPrioBadge(t.prioridade)}<span class="badge">${TK_CAT[t.categoria]||t.categoria}</span></div>
      ${t.ultima?`<p style="margin-top:8px;color:var(--muted);font-size:13px">${esc(t.ultima)}</p>`:""}
      <div class="meta" style="margin-top:6px"><span>💬 ${t.msgs}</span>${!t.aberto_por_eu?`<span>por ${esc(t.abridor)}</span>`:""}<span>${fmtDT(t.last_msg_at)}</span></div>
    </div></button>`).join("");
  el.querySelectorAll("[data-tk]").forEach(b=>b.addEventListener("click",()=>abrirTicketDetalhe(b.dataset.tk)));
}
function abrirTicket(canal){
  const catOpts=Object.entries(TK_CAT).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
  sheet(`<h2>${canal==="plataforma"?"Falar com a VIZELLO":"Abrir chamado"}</h2>
    <p class="sub">${canal==="plataforma"?"Sua mensagem vai para a equipe VIZELLO.":"Seu chamado vai para a administração do condomínio."}</p>
    <label>Assunto</label><input id="tkAssunto" class="field" placeholder="Resumo do chamado">
    <div style="display:flex;gap:10px"><div style="flex:1"><label>Categoria</label><select id="tkCat" class="field">${catOpts}</select></div>
      <div style="flex:1"><label>Prioridade</label><select id="tkPrio" class="field"><option value="baixa">Baixa</option><option value="normal" selected>Normal</option><option value="alta">Alta</option></select></div></div>
    <label>Mensagem</label><textarea id="tkCorpo" class="field" rows="4" placeholder="Descreva o que precisa..."></textarea>
    <label>Anexos (opcional)</label><input id="tkFiles" class="field" type="file" accept="image/*,application/pdf" multiple>
    <button class="btn" id="tkSend">Enviar chamado</button>`);
  $("#tkSend").addEventListener("click",async()=>{
    const assunto=$("#tkAssunto").value.trim(); if(!assunto) return toast("Informe o assunto.");
    const corpo=$("#tkCorpo").value.trim(); if(!corpo) return toast("Escreva a mensagem.");
    $("#tkSend").disabled=true;
    try{
      const r=await rpc("ticket_abrir",{p_cond:S.condId,p_canal:canal,p_assunto:assunto,p_categoria:$("#tkCat").value,p_prioridade:$("#tkPrio").value,p_corpo:corpo});
      const files=[...$("#tkFiles").files]; if(files.length && r.mensagem_id) await uploadAnexos("ticket_msg", r.mensagem_id, files);
      closeSheet(); toast("Chamado aberto ✅"); renderAtendimento();
    }catch(e){ $("#tkSend").disabled=false; toast(e.message); }
  });
}
function ticketBubble(m,signed){
  const anex=(m.anexos||[]).map(a=>({...a,url:signed[a.path]}));
  const side=m.eu?"flex-end":"flex-start", bg=m.eu?"var(--brand)":"var(--chip)", col=m.eu?"#fff":"var(--ink)";
  return `<div style="align-self:${side};max-width:84%">
    ${!m.eu?`<div style="font-size:11px;color:var(--muted);margin:0 0 3px 4px">${esc(m.autor)}</div>`:""}
    <div style="background:${bg};color:${col};padding:10px 12px;border-radius:14px;font-size:14px;white-space:pre-wrap;word-break:break-word">${esc(m.corpo)}</div>
    ${anex.length?anexoThumbs(anex):""}
    <div style="font-size:10.5px;color:var(--muted);text-align:${m.eu?"right":"left"};margin-top:3px">${fmtDT(m.created_at)}</div>
  </div>`;
}
function tkStatusControls(d,podeGerir){
  const btns=[];
  if(podeGerir){
    if(d.status!=="em_andamento"&&d.status!=="fechado") btns.push(`<button data-st="em_andamento">Em andamento</button>`);
    if(d.status!=="resolvido") btns.push(`<button data-st="resolvido">Marcar resolvido</button>`);
    if(d.status==="resolvido"||d.status==="fechado") btns.push(`<button data-st="aberto">Reabrir</button>`);
  }
  if(d.aberto_por_eu && d.status!=="fechado") btns.push(`<button data-st="fechado">Fechar chamado</button>`);
  return btns.length?`<div class="seg" style="margin-top:14px;flex-wrap:wrap">${btns.join("")}</div>`:"";
}
async function abrirTicketDetalhe(id){
  sheet('<div class="spin"></div>');
  let d;
  try{ d=await rpc("ticket_detalhe",{p_ticket:id}); }catch(e){ closeSheet(); return toast(e.message); }
  const paths=[]; (d.mensagens||[]).forEach(m=>(m.anexos||[]).forEach(a=>paths.push(a.path)));
  const signed=await signPaths(paths);
  const gestor=isGestor(S.role);
  const podeGerir = d.canal==="condominio" && gestor;   // responsável no app é a gestão (plataforma = VIZELLO responde no admin)
  $("#sheet").innerHTML='<div class="grab"></div>'+`
    <h2 style="margin-bottom:2px">${esc(d.assunto)}</h2>
    <div class="meta" style="margin-bottom:10px">${tkStatusBadge(d.status)}${tkPrioBadge(d.prioridade)}<span class="badge">${TK_CAT[d.categoria]||d.categoria}</span>${d.canal==="plataforma"?'<span class="badge" style="background:#e2eff2;color:#00596b">VIZELLO</span>':""}${!d.aberto_por_eu?`<span>por ${esc(d.abridor)}</span>`:""}</div>
    <div id="tkThread" style="max-height:46vh;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:4px 0">
      ${(d.mensagens||[]).map(m=>ticketBubble(m,signed)).join("")}
    </div>
    ${d.status==="fechado"?'<p class="sub" style="text-align:center;margin-top:14px">Chamado fechado.</p>':
    `<div style="margin-top:12px">
      <textarea id="tkReply" class="field" rows="2" placeholder="Escreva uma resposta..."></textarea>
      <input id="tkReplyFiles" class="field" type="file" accept="image/*,application/pdf" multiple style="margin-top:8px">
      <button class="btn" id="tkReplySend">Responder</button></div>`}
    ${tkStatusControls(d,podeGerir)}`;
  const thread=$("#tkThread"); if(thread) thread.scrollTop=thread.scrollHeight;
  const rs=$("#tkReplySend");
  if(rs) rs.addEventListener("click",async()=>{
    const corpo=$("#tkReply").value.trim(); if(!corpo) return toast("Escreva a resposta.");
    rs.disabled=true;
    try{
      const msgId=await rpc("ticket_mensagem_enviar",{p_ticket:id,p_corpo:corpo});
      const files=[...$("#tkReplyFiles").files]; if(files.length) await uploadAnexos("ticket_msg", msgId, files);
      abrirTicketDetalhe(id);
    }catch(e){ rs.disabled=false; toast(e.message); }
  });
  $("#sheet").querySelectorAll("[data-st]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("ticket_status",{p_ticket:id,p_status:b.dataset.st}); toast("Status atualizado"); abrirTicketDetalhe(id); }
    catch(e){ toast(e.message); }
  }));
}

// ===================================================================
// MÓDULO: PRESTAÇÃO DE CONTAS (receitas x despesas)
// ===================================================================
const DESP_CAT={geral:"Geral",manutencao:"Manutenção",limpeza:"Limpeza",seguranca:"Segurança",agua:"Água",energia:"Energia",pessoal:"Pessoal",administrativo:"Administrativo",obras:"Obras",outro:"Outro"};
const MESES_ABREV=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
async function renderPrestacaoContas(){
  const gestor=isGestor(S.role);
  view().innerHTML='<div class="spin"></div>'; $("#fab").classList.add("hide");
  const ano=S._contasAno||new Date().getFullYear();
  let pc;
  try{ pc=await rpc("prestacao_contas",{p_cond:S.condId,p_ano:ano}); }
  catch(e){ view().innerHTML=`<div class="subhead"><button class="back" data-goto="servicos">‹</button><div class="h" style="margin:0">Prestação de contas</div></div><p class="empty">${esc(e.message)}</p>`; view().querySelector('[data-goto]').addEventListener('click',()=>go('servicos')); return; }
  const meses=pc.meses||[];
  const maxV=Math.max(1,...meses.map(m=>Math.max(Number(m.receitas)||0,Number(m.despesas)||0)));
  const saldo=(Number(pc.total_receitas)||0)-(Number(pc.total_despesas)||0);
  const cp=pc.contas_pagar||{};
  const pcView = gestor ? (S._pcView||"resumo") : "resumo";
  let html=`<div class="subhead"><button class="back" data-goto="servicos">‹</button><div class="h" style="margin:0">📊 Prestação de contas <small>Ano ${ano}</small></div></div>`;
  if(gestor){
    const pend=(cp.a_vencer_qtd||0)+(cp.vencidas_qtd||0);
    html+=`<div class="seg" id="pcSeg" style="margin-bottom:14px">
      <button data-v="resumo" class="${pcView==="resumo"?"on":""}">Resumo &amp; DRE</button>
      <button data-v="pagar" class="${pcView==="pagar"?"on":""}">Contas a pagar${pend?` (${pend})`:""}</button></div>`;
  }
  if(gestor && pcView==="pagar"){
    html+=contasPagarView(cp);
    view().innerHTML=html;
    view().querySelector('[data-goto]').addEventListener('click',()=>go('servicos'));
    view().querySelectorAll('#pcSeg [data-v]').forEach(b=>b.addEventListener('click',()=>{ S._pcView=b.dataset.v; renderPrestacaoContas(); }));
    $("#cpNova")?.addEventListener("click",()=>lancarDespesa(true));
    $("#cpRec")?.addEventListener("click",configDespesasRecorrentes);
    view().querySelectorAll('[data-pagardesp]').forEach(b=>b.addEventListener('click',async()=>{
      try{ await rpc("despesa_status",{p_id:b.dataset.pagardesp,p_status:"pago"}); toast("Conta baixada ✅"); renderPrestacaoContas(); }catch(e){ toast(e.message); }
    }));
    view().querySelectorAll('[data-deldesp2]').forEach(b=>b.addEventListener('click',async()=>{
      if(!(await confirmar("Excluir esta conta a pagar?","Excluir"))) return;
      try{ await rpc("despesa_excluir",{p_id:b.dataset.deldesp2}); toast("Excluída"); renderPrestacaoContas(); }catch(e){ toast(e.message); }
    }));
    if(gestor){ const f=$("#fab"); f.classList.remove("hide"); f.onclick=()=>lancarDespesa(true); }
    return;
  }
  html+=`<div class="hub" style="grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
    <div class="hubcard" style="min-height:auto;padding:12px 10px"><small>Receitas</small><b style="font-size:15px;color:var(--ok)">${fmtMoney(pc.total_receitas)}</b></div>
    <div class="hubcard" style="min-height:auto;padding:12px 10px"><small>Despesas</small><b style="font-size:15px;color:var(--danger)">${fmtMoney(pc.total_despesas)}</b></div>
    <div class="hubcard" style="min-height:auto;padding:12px 10px"><small>Saldo</small><b style="font-size:15px;color:${saldo>=0?'var(--ok)':'var(--danger)'}">${fmtMoney(saldo)}</b></div>
  </div>`;
  html+=`<div class="hub" style="grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
    <div class="hubcard" style="min-height:auto;padding:12px 10px"><small>Saldo em caixa (acumulado)</small><b style="font-size:15px;color:${(Number(pc.saldo_acumulado)||0)>=0?'var(--ok)':'var(--danger)'}">${fmtMoney(pc.saldo_acumulado)}</b></div>
    <div class="hubcard" style="min-height:auto;padding:12px 10px"><small>Fundo de reserva</small><b style="font-size:15px;color:var(--brand)">${fmtMoney(pc.fundo_saldo)}</b></div>
  </div>`;
  if(gestor && (Number(cp.vencidas_valor)>0 || Number(cp.a_vencer_valor)>0)){
    html+=`<div class="tile clickable" id="cpAlerta" style="background:#fdfce4;border-color:#ece79a;cursor:pointer"><div class="row"><b style="flex:1">💸 Contas a pagar: ${fmtMoney((Number(cp.a_vencer_valor)||0)+(Number(cp.vencidas_valor)||0))}</b><span class="badge ${cp.vencidas_qtd?"urgente":""}">${cp.vencidas_qtd?cp.vencidas_qtd+" vencida(s)":"em dia"}</span></div></div>`;
  }
  html+=`<div class="chartcard"><div class="ct">Receitas <span style="color:var(--ok)">■</span> x Despesas <span style="color:var(--danger)">■</span> por mês</div>
    <div style="display:flex;align-items:flex-end;gap:4px;height:120px">${meses.map((m,i)=>{
      const rv=Number(m.receitas)||0, dv=Number(m.despesas)||0;
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%">
        <div style="flex:1;display:flex;align-items:flex-end;gap:2px;width:100%;justify-content:center">
          <div title="Receitas ${fmtMoney(rv)}" style="width:40%;background:var(--ok);border-radius:4px 4px 0 0;height:${rv?Math.max(2,Math.round(rv/maxV*100)):0}%"></div>
          <div title="Despesas ${fmtMoney(dv)}" style="width:40%;background:var(--danger);border-radius:4px 4px 0 0;height:${dv?Math.max(2,Math.round(dv/maxV*100)):0}%"></div>
        </div>
        <div style="font-size:9.5px;color:var(--muted)">${MESES_ABREV[i]}</div>
      </div>`;
    }).join("")}</div></div>`;
  html+=dreCategoriaBlock(pc);
  const fmovs=pc.fundo_movs||[];
  html+=`<div class="chartcard"><div class="row" style="align-items:center"><div class="ct" style="flex:1;margin:0">🏦 Fundo de reserva <span style="color:var(--muted)">— saldo ${fmtMoney(pc.fundo_saldo)}</span></div>${gestor?'<button class="badge" id="fundoAdd">＋ Lançar</button>':''}</div>
    ${fmovs.length? fmovs.map(f=>`<div class="row" style="font-size:13px;padding:7px 0;border-bottom:1px solid var(--line);align-items:center"><span style="flex:1">${f.tipo==='aporte'?'⬆️':'⬇️'} ${esc(f.descricao||(f.tipo==='aporte'?'Aporte':'Retirada'))} <span style="color:var(--muted)">· ${fmtDate(f.data)}</span></span><b style="color:${f.tipo==='aporte'?'var(--ok)':'var(--danger)'}">${f.tipo==='aporte'?'+':'−'}${fmtMoney(f.valor)}</b>${gestor?`<button class="badge" data-delfundo="${f.id}" style="margin-left:8px">✕</button>`:''}</div>`).join('') : '<p class="sub" style="margin:8px 2px 2px">Nenhum movimento no fundo ainda.</p>'}
  </div>`;
  html+=`<button class="btn secondary" id="pcBalancete" style="margin:2px 0 12px">📄 Gerar balancete (PDF)</button>`;
  html+=`<div class="h" style="margin-top:6px">Despesas pagas ${gestor?'<small>Toque em ＋ para lançar</small>':''}</div>`;
  const desp=pc.despesas_lista||[];
  const anexMap=desp.length?await fetchAnexos("despesa",desp.map(d=>d.id)):{};
  if(!desp.length) html+=emptyBox("🧾","Nenhuma despesa lançada ainda.", gestor?"Toque em ＋ para lançar a primeira.":"A administração ainda não lançou despesas.");
  else html+=`<div>${desp.map(d=>`<div class="tile"><div class="row"><div style="flex:1;min-width:0">
    <b>${esc(d.descricao)}</b>
    <div class="meta" style="margin-top:6px"><span class="badge">${DESP_CAT[d.categoria]||d.categoria}</span><span>🗓️ ${fmtDate(d.data)}</span></div>
    </div><div style="text-align:right;flex:0 0 auto"><b style="color:var(--danger)">${fmtMoney(d.valor)}</b>${gestor?`<div><button class="badge" data-deldesp="${d.id}" style="margin-top:6px">Excluir</button></div>`:''}</div></div>
    ${anexMap[d.id]&&anexMap[d.id].length?anexoThumbs(anexMap[d.id]):""}</div>`).join("")}</div>`;
  view().innerHTML=html;
  view().querySelector('[data-goto]').addEventListener('click',()=>go('servicos'));
  view().querySelectorAll('#pcSeg [data-v]').forEach(b=>b.addEventListener('click',()=>{ S._pcView=b.dataset.v; renderPrestacaoContas(); }));
  $("#cpAlerta")?.addEventListener("click",()=>{ S._pcView="pagar"; renderPrestacaoContas(); });
  $("#pcBalancete")?.addEventListener("click",()=>gerarBalancete(pc,ano,saldo));
  $("#fundoAdd")?.addEventListener("click",fundoLancar);
  view().querySelectorAll('[data-delfundo]').forEach(b=>b.addEventListener('click',async()=>{
    if(!(await confirmar("Excluir este movimento do fundo de reserva?","Excluir"))) return;
    try{ await rpc("fundo_excluir",{p_id:b.dataset.delfundo}); toast("Excluído"); renderPrestacaoContas(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll('[data-deldesp]').forEach(b=>b.addEventListener('click',async()=>{
    if(!(await confirmar("Excluir esta despesa?","Excluir"))) return;
    try{ await rpc("despesa_excluir",{p_id:b.dataset.deldesp}); toast("Despesa excluída"); renderPrestacaoContas(); }catch(e){ toast(e.message); }
  }));
  if(gestor){ const f=$("#fab"); f.classList.remove("hide"); f.onclick=()=>lancarDespesa(false); }
}
function fundoLancar(){
  let tipo="aporte";
  sheet(`<h2>Fundo de reserva</h2>
    <p class="sub" style="margin:0 2px 10px">Registre aportes (dinheiro guardado no fundo) e retiradas (uso do fundo).</p>
    <div class="seg" id="frTipo"><button data-t="aporte" class="on">Aporte (+)</button><button data-t="retirada">Retirada (−)</button></div>
    <label style="margin-top:10px">Valor (R$)</label><input id="frValor" class="field" inputmode="decimal" placeholder="0,00">
    <label>Descrição (opcional)</label><input id="frDesc" class="field" placeholder="Ex.: transferência mensal para o fundo">
    <label>Data</label><input id="frData" class="field" type="date" value="${new Date().toISOString().slice(0,10)}">
    <button class="btn" id="frSave" style="margin-top:14px">Lançar</button>`);
  document.querySelectorAll("#frTipo [data-t]").forEach(b=>b.addEventListener("click",()=>{ tipo=b.dataset.t; document.querySelectorAll("#frTipo [data-t]").forEach(x=>x.classList.toggle("on",x===b)); }));
  $("#frSave").addEventListener("click",async()=>{
    const valor=Number($("#frValor").value.trim().replace(/\./g,"").replace(",","."));
    if(!(valor>0)) return toast("Informe um valor válido.");
    $("#frSave").disabled=true;
    try{ await rpc("fundo_lancar",{p_cond:S.condId,p_tipo:tipo,p_valor:valor,p_descricao:$("#frDesc").value.trim()||null,p_data:$("#frData").value||null});
      closeSheet(); toast("Fundo atualizado ✅"); renderPrestacaoContas(); }
    catch(e){ toast(e.message); $("#frSave").disabled=false; }
  });
}
function dreCategoriaBlock(pc){
  const cats=pc.despesas_por_categoria||[]; if(!cats.length) return "";
  const tot=cats.reduce((s,c)=>s+(Number(c.valor)||0),0)||1;
  const res=(Number(pc.total_receitas)||0)-(Number(pc.total_despesas)||0);
  return `<div class="chartcard"><div class="ct">🧾 DRE — despesas por categoria</div>${cats.map(c=>`
    <div style="margin-bottom:10px"><div class="row" style="font-size:13px"><span style="flex:1">${DESP_CAT[c.categoria]||c.categoria}</span><b>${fmtMoney(c.valor)}</b></div>
    <div style="height:7px;background:var(--line);border-radius:999px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${Math.round((Number(c.valor)||0)/tot*100)}%;background:var(--danger)"></div></div></div>`).join("")}
    <div class="row" style="border-top:1px solid var(--line);padding-top:8px;margin-top:4px"><span style="flex:1;color:var(--muted)">Resultado do ano</span><b style="color:${res>=0?'var(--ok)':'var(--danger)'}">${fmtMoney(res)}</b></div>
  </div>`;
}
function contasPagarView(cp){
  const lista=cp.lista||[];
  let h=`<div class="hub" style="grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
    <div class="hubcard" style="min-height:auto;padding:12px 10px"><small>A vencer</small><b style="font-size:15px">${fmtMoney(cp.a_vencer_valor)}</b></div>
    <div class="hubcard" style="min-height:auto;padding:12px 10px"><small>Vencidas</small><b style="font-size:15px;color:${cp.vencidas_valor?'var(--danger)':'inherit'}">${fmtMoney(cp.vencidas_valor)}</b></div>
    <div class="hubcard" style="min-height:auto;padding:12px 10px"><small>Pagas no mês</small><b style="font-size:15px;color:var(--ok)">${fmtMoney(cp.pagas_mes_valor)}</b></div>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn secondary" id="cpNova" style="margin:0">➕ Nova conta</button><button class="btn secondary" id="cpRec" style="margin:0">🔁 Recorrentes</button></div>`;
  if(!lista.length) return h+emptyBox("✅","Nenhuma conta a pagar em aberto.","Lance despesas como “conta a pagar” e elas aparecem aqui.");
  h+=lista.map(d=>`<div class="tile" style="padding:14px">
    <div class="row"><h3 style="flex:1;font-size:15px">${esc(d.descricao)}</h3><b style="color:${d.vencida?'var(--danger)':'inherit'}">${fmtMoney(d.valor)}</b></div>
    <div class="meta"><span class="badge">${DESP_CAT[d.categoria]||d.categoria}</span><span>📅 vence ${fmtDate(d.vencimento)}</span>${d.vencida?'<span class="badge urgente">Vencida</span>':''}${d.recorrente?'<span class="badge">🔁 mensal</span>':''}</div>
    <div class="seg" style="margin-top:10px"><button class="btn" data-pagardesp="${d.id}" style="width:auto;margin:0;padding:9px 16px">✅ Marcar paga</button><button class="badge cancelada" data-deldesp2="${d.id}">Excluir</button></div>
  </div>`).join("");
  return h;
}
function lancarDespesa(pendentePadrao){
  const catOpts=Object.entries(DESP_CAT).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
  const hoje=new Date().toISOString().slice(0,10);
  sheet(`<h2>${pendentePadrao?"Nova conta a pagar":"Lançar despesa"}</h2>
    <label>Descrição</label><input id="dpDesc" class="field" placeholder="Ex.: Conta de água — março">
    <div style="display:flex;gap:10px"><div style="flex:1"><label>Valor (R$)</label><input id="dpValor" class="field" inputmode="decimal" placeholder="0,00"></div>
      <div style="flex:1"><label>Data</label><input id="dpData" class="field" type="date" value="${hoje}"></div></div>
    <label>Categoria</label><select id="dpCat" class="field">${catOpts}</select>
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="dpPend" ${pendentePadrao?"checked":""}> É conta a pagar (ainda não paga)</label>
    <div id="dpVencWrap" class="${pendentePadrao?"":"hide"}"><label>Vencimento</label><input id="dpVenc" class="field" type="date" value="${hoje}"></div>
    <label>Comprovante (opcional)</label><input id="dpArq" class="field" type="file" accept="image/*,.pdf">
    <button class="btn" id="dpSave">${pendentePadrao?"Adicionar conta":"Lançar"}</button>`);
  $("#dpPend").addEventListener("change",e=>$("#dpVencWrap").classList.toggle("hide",!e.target.checked));
  $("#dpSave").addEventListener("click",async()=>{
    const desc=$("#dpDesc").value.trim(); if(!desc) return toast("Informe a descrição.");
    const vRaw=$("#dpValor").value.trim().replace(/\./g,"").replace(",","."); const valor=Number(vRaw);
    if(!vRaw||isNaN(valor)||valor<0) return toast("Valor inválido.");
    const pend=$("#dpPend").checked, venc=pend?($("#dpVenc").value||null):null;
    if(pend && !venc) return toast("Informe o vencimento.");
    $("#dpSave").disabled=true;
    try{ const id=await rpc("despesa_lancar",{p_cond:S.condId,p_descricao:desc,p_valor:valor,p_data:$("#dpData").value||null,p_categoria:$("#dpCat").value,p_vencimento:venc,p_status:pend?"pendente":"pago"});
      const files=$("#dpArq").files; if(id&&files&&files.length){ toast("Enviando comprovante..."); await uploadAnexos("despesa",id,files); }
      closeSheet(); toast(pend?"Conta a pagar adicionada ✅":"Despesa lançada ✅"); renderPrestacaoContas();
    }catch(e){ $("#dpSave").disabled=false; toast(e.message); }
  });
}
async function configDespesasRecorrentes(){
  sheet('<h2>Despesas recorrentes</h2><div class="spin"></div>');
  let recs=[];
  try{ const r=await sb.from("despesas_recorrentes").select("*").eq("condominio_id",S.condId).order("created_at"); recs=r.data||[]; }catch(_){}
  const list=recs.length?recs.map(r=>`<div class="tile" style="padding:12px 14px">
      <div class="row"><h3 style="flex:1;font-size:15px">${esc(r.descricao)}</h3><b>${fmtMoney(r.valor)}</b></div>
      <div class="meta"><span class="badge">${DESP_CAT[r.categoria]||r.categoria}</span><span>🗓️ vence dia ${r.dia_vencimento}</span><span class="badge ${r.ativo?"resolvida":"cancelada"}">${r.ativo?"Ativa":"Pausada"}</span></div>
      <div class="meta"><button class="badge" data-drecedit="${r.id}" style="cursor:pointer">✏️ Editar</button><button class="badge cancelada" data-drecdel="${r.id}" style="cursor:pointer">🗑️ Remover</button></div>
    </div>`).join(""):'<p class="sub">Nenhuma despesa recorrente ainda.</p>';
  sheet(`<h2>🔁 Despesas recorrentes</h2>
    <p class="sub" style="margin:0 2px 10px">Custos fixos mensais (zelador, limpeza, internet…) viram contas a pagar automaticamente todo mês.</p>
    <div id="drecList">${list}</div>
    <button class="btn secondary" id="drecAdd" style="margin:8px 0 4px">＋ Nova despesa recorrente</button>
    ${recs.some(r=>r.ativo)?`<button class="btn" id="drecGerar" style="margin:8px 0 4px">⚡ Gerar as deste mês agora</button>`:""}`);
  $("#drecAdd").addEventListener("click",()=>formDespesaRecorrente());
  $("#drecGerar")?.addEventListener("click",async()=>{
    if(!await confirmar("Gerar as contas recorrentes deste mês agora? As já lançadas neste mês não são duplicadas.","Gerar agora")) return;
    try{ const n=await rpc("despesas_recorrentes_gerar_agora",{p_cond:S.condId});
      toast(n>0?`${n} conta(s) gerada(s) 🧾`:"Tudo já estava lançado neste mês."); closeSheet(); S._pcView="pagar"; renderPrestacaoContas();
    }catch(e){ toast(e.message); }
  });
  $("#drecList").querySelectorAll("[data-drecedit]").forEach(b=>b.addEventListener("click",()=>formDespesaRecorrente(recs.find(r=>r.id===b.dataset.drecedit))));
  $("#drecList").querySelectorAll("[data-drecdel]").forEach(b=>b.addEventListener("click",async()=>{
    if(!await confirmar("Remover esta despesa recorrente? As já geradas não são afetadas.","Remover")) return;
    try{ await rpc("despesa_recorrente_excluir",{p_id:b.dataset.drecdel}); toast("Removida"); configDespesasRecorrentes(); }catch(e){ toast(e.message); }
  }));
}
function formDespesaRecorrente(r){
  const catOpts=Object.entries(DESP_CAT).map(([k,v])=>`<option value="${k}" ${r&&r.categoria===k?"selected":""}>${v}</option>`).join("");
  sheet(`<h2>${r?"Editar":"Nova"} despesa recorrente</h2>
    <label>Descrição</label><input id="drDesc" class="field" placeholder="Ex.: Salário do zelador" value="${r?esc(r.descricao):""}">
    <div style="display:flex;gap:10px">
      <div style="flex:1"><label>Valor (R$)</label><input id="drValor" class="field" type="number" step="0.01" value="${r?r.valor:""}" placeholder="1500.00"></div>
      <div style="flex:1"><label>Vence dia</label><input id="drDia" class="field" type="number" min="1" max="28" value="${r?r.dia_vencimento:10}"></div>
    </div>
    <label>Categoria</label><select id="drCat" class="field">${catOpts}</select>
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="drAtivo" ${(!r||r.ativo)?"checked":""}> Ativa</label>
    <button class="btn" id="drSave" style="margin-top:14px">${r?"Salvar":"Criar"}</button>`);
  $("#drSave").addEventListener("click",async()=>{
    const desc=$("#drDesc").value.trim(); if(!desc) return toast("Informe a descrição.");
    const valor=Number($("#drValor").value); if(!(valor>=0)) return toast("Valor inválido.");
    const dia=Number($("#drDia").value); if(!(dia>=1&&dia<=28)) return toast("Dia de vencimento entre 1 e 28.");
    try{ await rpc("despesa_recorrente_salvar",{p_cond:S.condId,p_descricao:desc,p_valor:valor,p_dia_venc:dia,p_categoria:$("#drCat").value,p_ativo:$("#drAtivo").checked,p_id:r?r.id:null});
      toast("Despesa recorrente salva 🔁"); configDespesasRecorrentes();
    }catch(e){ toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: PAINEL DO SÍNDICO (dashboard) — só gestão
// ===================================================================
async function renderPainel(){
  if(!isGestor(S.role)){ go("servicos"); return; }
  view().innerHTML=subhead("📈 Painel do síndico <small>Visão geral do condomínio</small>")+'<div class="spin"></div>';
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#fab").classList.add("hide");
  const ano=new Date().getFullYear();
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  const mesIni=new Date(hoje.getFullYear(),hoje.getMonth(),1);
  const mesFim=new Date(hoje.getFullYear(),hoje.getMonth()+1,1);
  let pc={meses:[],total_receitas:0,total_despesas:0}, cobr=[], ocor=[], resv=[], enco=[], manu=[], leit=[], totalUnid=0;
  try{
    const [rpcPc,cb,oc,rv,en,mn,lt,uc]=await Promise.all([
      rpc("prestacao_contas",{p_cond:S.condId,p_ano:ano}).catch(()=>null),
      sb.from("cobrancas").select("status,valor,vencimento,unidade_id").eq("condominio_id",S.condId),
      sb.from("ocorrencias").select("status").eq("condominio_id",S.condId),
      sb.from("reservas").select("status,inicio").eq("condominio_id",S.condId),
      sb.from("encomendas").select("status").eq("condominio_id",S.condId),
      sb.from("manutencoes").select("proxima_data,ativo").eq("condominio_id",S.condId).eq("ativo",true),
      sb.from("leituras").select("tipo,competencia,unidade_id,consumo").eq("condominio_id",S.condId),
      sb.from("unidades").select("id",{count:"exact",head:true}).eq("condominio_id",S.condId),
    ]);
    if(rpcPc) pc=rpcPc;
    cobr=cb.data||[]; ocor=oc.data||[]; resv=rv.data||[]; enco=en.data||[]; manu=mn.data||[]; leit=lt.data||[]; totalUnid=uc.count||0;
  }catch(e){
    view().innerHTML=subhead("📈 Painel do síndico")+`<p class="empty">${esc(e.message||"Erro ao carregar")}</p>`;
    $("#voltarServ")?.addEventListener("click",()=>go("servicos")); return;
  }
  // --- Finanças / inadimplência ---
  const abertas=cobr.filter(c=>c.status==="aberta");
  const totalAberto=abertas.reduce((s,c)=>s+Number(c.valor||0),0);
  const vencidas=abertas.filter(c=>c.vencimento && new Date(c.vencimento)<hoje);
  const unidInad=new Set(vencidas.map(c=>c.unidade_id)).size;
  const totalPago=cobr.filter(c=>c.status==="paga").reduce((s,c)=>s+Number(c.valor||0),0);
  const totalCobrado=totalPago+totalAberto;
  const pctInad=totalCobrado>0?Math.round(totalAberto/totalCobrado*100):0;
  const saldo=(Number(pc.total_receitas)||0)-(Number(pc.total_despesas)||0);
  // --- Ocorrências por status ---
  const ocSt={aberta:0,em_andamento:0,resolvida:0,cancelada:0};
  ocor.forEach(o=>{ if(ocSt[o.status]!=null) ocSt[o.status]++; });
  const ocAbertas=ocSt.aberta+ocSt.em_andamento;
  // --- Reservas / encomendas / manutenções ---
  const resMes=resv.filter(r=>{ const d=new Date(r.inicio); return d>=mesIni && d<mesFim; }).length;
  const resPend=resv.filter(r=>r.status==="pendente").length;
  const encPend=enco.filter(e=>e.status==="recebida").length;
  const manVenc=manu.filter(m=>m.proxima_data && new Date(m.proxima_data+"T00:00:00")<hoje).length;
  const man30=manu.filter(m=>{ if(!m.proxima_data) return false; const dd=(new Date(m.proxima_data+"T00:00:00")-hoje)/864e5; return dd>=0&&dd<=30; }).length;
  // --- Consumo (leituras): resumo do último mês lançado por tipo ---
  const CONS_META={agua:{ic:"💧",nome:"Água",un:"m³"},gas:{ic:"🔥",nome:"Gás",un:"m³"},energia:{ic:"⚡",nome:"Energia",un:"kWh"}};
  const consResumo=[];
  ["agua","gas","energia"].forEach(tp=>{
    const rows=leit.filter(l=>l.tipo===tp); if(!rows.length) return;
    const comps=[...new Set(rows.map(r=>r.competencia))].sort();
    const ult=comps[comps.length-1], ant=comps[comps.length-2];
    const somaCnt=c=>{ const rs=rows.filter(r=>r.competencia===c && r.consumo!=null); return {tot:rs.reduce((s,r)=>s+Number(r.consumo),0), cnt:rs.length}; };
    const u=somaCnt(ult), a=ant?somaCnt(ant):null;
    const varPct=(a&&a.tot>0)?Math.round((u.tot-a.tot)/a.tot*100):null;
    consResumo.push({tp,...CONS_META[tp],ult,tot:u.tot,cnt:u.cnt,media:u.cnt?u.tot/u.cnt:0,varPct});
  });
  const aguaRes=consResumo.find(c=>c.tp==="agua");
  const semLeitura=aguaRes?Math.max(0,totalUnid-aguaRes.cnt):0;

  const kpi=(label,val,cor,sub)=>`<div class="hubcard" style="min-height:auto;padding:14px;gap:3px;align-items:flex-start;text-align:left">
    <small>${label}</small><b style="font-size:19px;${cor?`color:${cor}`:""}">${val}</b>${sub?`<small style="color:var(--muted)">${sub}</small>`:""}</div>`;

  let html=subhead("📈 Painel do síndico <small>Visão geral · atualizado agora</small>");
  html+=`<div class="hub" style="grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
    ${kpi("Inadimplência",pctInad+"%",pctInad>0?"var(--danger)":"var(--ok)",fmtMoney(totalAberto)+" · "+unidInad+" un.")}
    ${kpi("Saldo do ano",fmtMoney(saldo),saldo>=0?"var(--ok)":"var(--danger)","Rec "+fmtMoney(pc.total_receitas))}
    ${kpi("Ocorrências abertas",ocAbertas,ocAbertas?"var(--warn)":"var(--ok)",ocSt.resolvida+" resolvidas")}
    ${kpi("Reservas no mês",resMes,null,resPend?resPend+" a aprovar":"em dia")}
  </div>`;

  // Donut de inadimplência
  html+=`<div class="chartcard"><div class="ct">💰 Cobranças (valor)</div>
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
      <div style="width:112px;height:112px;border-radius:50%;background:conic-gradient(var(--danger) ${pctInad*3.6}deg, var(--ok) 0);display:grid;place-items:center;flex:0 0 auto">
        <div style="width:76px;height:76px;border-radius:50%;background:var(--surface);display:grid;place-items:center;font-weight:800;font-size:19px">${pctInad}%</div></div>
      <div style="font-size:13.5px;line-height:1.9;flex:1;min-width:150px">
        <div><span style="color:var(--danger)">■</span> Em aberto: <b>${fmtMoney(totalAberto)}</b></div>
        <div><span style="color:var(--ok)">■</span> Recebido: <b>${fmtMoney(totalPago)}</b></div>
        <div style="color:var(--muted)">${vencidas.length} cobrança(s) vencida(s) · ${unidInad} unidade(s)</div>
      </div></div></div>`;

  // Receitas x Despesas por mês (reaproveita o padrão da prestação de contas)
  const meses=pc.meses||[];
  if(meses.length){
    const maxV=Math.max(1,...meses.map(m=>Math.max(Number(m.receitas)||0,Number(m.despesas)||0)));
    html+=`<div class="chartcard"><div class="ct">Receitas <span style="color:var(--ok)">■</span> x Despesas <span style="color:var(--danger)">■</span> · ${ano}</div>
      <div style="display:flex;align-items:flex-end;gap:4px;height:120px">${meses.map((m,i)=>{
        const rv=Number(m.receitas)||0, dv=Number(m.despesas)||0;
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%">
          <div style="flex:1;display:flex;align-items:flex-end;gap:2px;width:100%;justify-content:center">
            <div title="Receitas ${fmtMoney(rv)}" style="width:40%;background:var(--ok);border-radius:4px 4px 0 0;height:${rv?Math.max(2,Math.round(rv/maxV*100)):0}%"></div>
            <div title="Despesas ${fmtMoney(dv)}" style="width:40%;background:var(--danger);border-radius:4px 4px 0 0;height:${dv?Math.max(2,Math.round(dv/maxV*100)):0}%"></div>
          </div><div style="font-size:9.5px;color:var(--muted)">${MESES_ABREV[i]}</div></div>`;
      }).join("")}</div></div>`;
  }

  // Ocorrências por status (barras horizontais)
  const ocRows=[["aberta","Abertas","#00596b"],["em_andamento","Em andamento","var(--warn)"],["resolvida","Resolvidas","var(--ok)"],["cancelada","Canceladas","#9aa4a8"]];
  const ocMax=Math.max(1,...ocRows.map(([k])=>ocSt[k]));
  html+=`<div class="chartcard"><div class="ct">🛠️ Ocorrências por status</div>
    ${ocRows.map(([k,lbl,cor])=>`<div style="display:flex;align-items:center;gap:8px;margin:7px 0;font-size:13px">
      <span style="width:104px;flex:0 0 auto;color:var(--muted)">${lbl}</span>
      <div style="flex:1;background:var(--chip);border-radius:6px;height:16px;overflow:hidden"><div style="height:100%;width:${Math.round(ocSt[k]/ocMax*100)}%;background:${cor};border-radius:6px"></div></div>
      <b style="width:26px;text-align:right">${ocSt[k]}</b></div>`).join("")}</div>`;

  // Consumo (água/gás/energia) — último mês lançado
  if(consResumo.length){
    html+=`<div class="chartcard"><div class="ct">💧 Consumo · último mês lançado</div>`
      +consResumo.map(c=>`<div style="display:flex;align-items:center;gap:10px;margin:8px 0">
        <span style="font-size:18px;width:22px;text-align:center;flex:0 0 auto">${c.ic}</span>
        <div style="flex:1;min-width:0"><b>${esc(c.nome)}</b> <span class="sub" style="margin:0">· ${compLabel(c.ult)} · ${c.cnt} un.</span>
          <div class="meta" style="margin-top:2px"><span>Total ${fmtNum(c.tot)} ${c.un}</span><span>Média ${fmtNum(Math.round(c.media*100)/100)} ${c.un}/un.</span></div></div>
        ${c.varPct!=null?`<span class="badge ${c.varPct>0?"urgente":"resolvida"}" style="flex:0 0 auto">${c.varPct>0?"▲":"▼"} ${Math.abs(c.varPct)}%</span>`:""}
      </div>`).join("")
      +`</div>`;
  }

  // Precisa de atenção
  const alertas=[];
  if(vencidas.length) alertas.push([`${vencidas.length} cobrança(s) vencida(s)`,"financeiro","💸"]);
  if(manVenc) alertas.push([`${manVenc} manutenção(ões) vencida(s)`,"manutencoes","🔧"]);
  if(man30) alertas.push([`${man30} manutenção(ões) nos próximos 30 dias`,"manutencoes","📅"]);
  if(encPend) alertas.push([`${encPend} encomenda(s) aguardando retirada`,"portaria","📦"]);
  if(resPend) alertas.push([`${resPend} reserva(s) aguardando aprovação`,"reservas","⏳"]);
  if(ocAbertas) alertas.push([`${ocAbertas} ocorrência(s) em aberto`,"ocorrencias","🛠️"]);
  if(semLeitura&&aguaRes) alertas.push([`${semLeitura} unidade(s) sem leitura de água (${compLabel(aguaRes.ult)})`,"consumo","💧"]);
  html+=`<div class="h" style="margin-top:18px">Precisa de atenção</div>`;
  html+= alertas.length? alertas.map(([txt,goto,ic])=>`<button class="tile" data-goto="${goto}" style="width:100%;text-align:left;display:block">
    <div class="row"><span style="font-size:20px">${ic}</span><h3 style="flex:1;font-size:15px;margin:0">${txt}</h3><span style="color:var(--muted)">›</span></div></button>`).join("")
    : '<p class="sub">Tudo em dia por aqui. 🎉</p>';

  view().innerHTML=html;
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  view().querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.goto)));
}

// ===================================================================
// MÓDULO: SOS / EMERGÊNCIA (botão de pânico)
// ===================================================================
const SOS_TIPOS=[
  {id:"emergencia",ic:"🆘",nome:"Emergência"},
  {id:"seguranca",ic:"🚨",nome:"Segurança"},
  {id:"saude",ic:"🚑",nome:"Saúde"},
  {id:"incendio",ic:"🔥",nome:"Incêndio"},
];
const SOS_LABEL={emergencia:"🆘 Emergência",seguranca:"🚨 Segurança",saude:"🚑 Saúde",incendio:"🔥 Incêndio",outro:"❗ Emergência"};
async function renderSOS(){
  loading();
  const gestor=isGestor(S.role)||S.role==="portaria";
  let unids=S._unids;
  if(gestor && !unids){ const {data:u}=await sb.from("unidades").select("id,bloco,numero").eq("condominio_id",S.condId); unids=u||[]; S._unids=unids; }
  let html=`<div class="subhead"><button class="back" data-goto="servicos">‹</button><div class="h" style="margin:0">🆘 SOS / Emergência <small>Alerta imediato à portaria</small></div></div>`;

  const {data:meus}=await sb.from("sos_alertas").select("*").eq("user_id",S.user.id).eq("status","ativo").order("created_at",{ascending:false}).limit(1);
  const meu=meus&&meus[0];
  if(meu){
    html+=`<div class="emerg-banner"><b>${SOS_LABEL[meu.tipo]||"Alerta"} enviado</b>
      <div style="margin-top:4px;font-size:13px">A portaria e a gestão foram avisadas${meu.mensagem?": "+esc(meu.mensagem):""}. 🕒 ${fmtDate(meu.created_at)}</div></div>
      <button class="btn secondary" data-soscancel="${meu.id}" style="margin-bottom:18px">Cancelar meu alerta</button>`;
  }else{
    html+=`<p class="sub" style="margin:2px 2px 12px">Toque no tipo de emergência. A portaria e a gestão recebem o alerta na hora — com sua unidade e localização.</p>
      <div class="hub">${SOS_TIPOS.map(t=>`<button class="hubcard" data-sos="${t.id}" style="background:#fdecea;border-color:#f0b9b3;align-items:center;text-align:center;min-height:120px;justify-content:center">
        <span class="ic" style="font-size:36px">${t.ic}</span><b style="color:var(--danger)">${t.nome}</b></button>`).join("")}</div>`;
  }

  if(gestor){
    const {data:ativos}=await sb.from("sos_alertas").select("*").eq("condominio_id",S.condId).eq("status","ativo").order("created_at",{ascending:false});
    html+=`<div class="h" style="font-size:16px;margin:22px 2px 8px">Alertas ativos (${(ativos||[]).length})</div>`;
    if(!ativos||!ativos.length){ html+=`<p class="sub" style="margin:0 2px">Nenhum alerta ativo. ✅</p>`; }
    else html+=ativos.map(a=>{
      const un=(unids||[]).find(u=>u.id===a.unidade_id);
      const map=(a.lat&&a.lng)?`<a class="badge" href="https://maps.google.com/?q=${a.lat},${a.lng}" target="_blank" rel="noopener">📍 Mapa</a>`:"";
      return `<div class="tile" style="border-color:var(--danger)"><div class="row">
        <h3 style="flex:1;font-size:15px">${SOS_LABEL[a.tipo]||"Emergência"}</h3><span class="badge emergencia">ATIVO</span></div>
        <div class="meta"><span>🏠 ${un?esc(unitLabel(un.bloco,un.numero)):"—"}</span><span>🕒 ${fmtDate(a.created_at)}</span>${map}</div>
        ${a.mensagem?`<p style="margin-top:6px">${esc(a.mensagem)}</p>`:""}
        <button class="btn" data-sosatende="${a.id}" style="margin-top:10px">✅ Atender</button></div>`;
    }).join("");
  }

  view().innerHTML=html; $("#fab").classList.add("hide");
  view().querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.goto)));
  view().querySelectorAll("[data-sos]").forEach(b=>b.addEventListener("click",()=>dispararSOS(b.dataset.sos)));
  view().querySelector("[data-soscancel]")?.addEventListener("click",async e=>{
    if(!await confirmar("Cancelar seu alerta de emergência?","Cancelar alerta")) return;
    try{ await rpc("sos_cancelar",{p_id:e.currentTarget.dataset.soscancel}); toast("Alerta cancelado"); renderSOS(); }catch(x){ toast(x.message); }
  });
  view().querySelectorAll("[data-sosatende]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("sos_atender",{p_id:b.dataset.sosatende}); toast("Marcado como atendido ✅"); renderSOS(); }catch(e){ toast(e.message); }
  }));
}
async function dispararSOS(tipo){
  const nome=(SOS_TIPOS.find(t=>t.id===tipo)?.nome||"emergência").toLowerCase();
  if(!await confirmar(`Enviar alerta de ${nome} para a portaria agora? Sua localização será compartilhada com a portaria e a gestão para agilizar o socorro.`,"🆘 Enviar alerta")) return;
  toast("Enviando alerta...");
  const send=async(lat,lng)=>{
    try{ await rpc("sos_disparar",{p_cond:S.condId,p_tipo:tipo,p_mensagem:null,p_lat:lat,p_lng:lng}); toast("Alerta enviado 🆘"); renderSOS(); }
    catch(e){ toast(e.message); }
  };
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      p=>send(p.coords.latitude,p.coords.longitude),
      ()=>send(null,null),
      {enableHighAccuracy:true,timeout:6000,maximumAge:0});
  }else send(null,null);
}
function renderServicos(){
  const cards=[
    {id:"sos",ic:"🆘",nome:"SOS / Emergência",desc:"Alerta imediato à portaria e gestão",on:true},
    {id:"reservas",ic:"📅",nome:"Reservas",desc:"Áreas comuns: salão, churrasqueira, quadra",on:true},
  ];
  if(isGestor(S.role)) cards.unshift({id:"painel",ic:"📈",nome:"Painel do síndico",desc:"Visão geral: finanças, ocorrências e reservas",on:true});
  cards.push(...[
    {id:"financeiro",ic:"💰",nome:"Financeiro",desc:"Taxa condominial e cobranças",on:true},
    {id:"contas",ic:"📊",nome:"Prestação de contas",desc:"Receitas x despesas do condomínio",on:true},
    {id:"assembleias",ic:"🗳️",nome:"Assembleias",desc:"Pautas e votações online",on:true},
    {id:"enquetes",ic:"📊",nome:"Enquetes",desc:"Consultas rápidas ao condomínio",on:true},
    {id:"manutencoes",ic:"🔧",nome:"Manutenções",desc:"Extintores, elevador, AVCB...",on:true},
    {id:"consumo",ic:"💧",nome:"Consumo",desc:"Água, gás e energia por unidade",on:true},
    {id:"mural",ic:"📣",nome:"Mural",desc:"Classificados, achados e recados",on:true},
    {id:"documentos",ic:"📄",nome:"Documentos",desc:"Convenção, regulamento, atas",on:true},
    {id:"atendimento",ic:"🎧",nome:"Atendimento",desc:"Abra um chamado e acompanhe respostas",on:true},
    {id:"conversas",ic:"💬",nome:"Mensagens",desc:"Fale direto com a gestão ou a portaria",on:true},
    {id:"pesquisas",ic:"⭐",nome:"Satisfação",desc:"Pesquisas e NPS do condomínio",on:true},
    {id:"cadastros",ic:"🚗",nome:"Veículos & Pets",desc:"Cadastros da sua unidade",on:true},
    {id:"autorizacoes",ic:"🔓",nome:"Autorizações",desc:"Libere pessoas e delivery recorrentes",on:true},
  ]);
  if(isPortaria(S.role)) cards.push({id:"livro",ic:"📒",nome:"Livro de Portaria",desc:"Registro de turno",on:true});
  if(isGestor(S.role)) cards.push({id:"vagas",ic:"🅿️",nome:"Vagas",desc:"Garagem do condomínio",on:true});
  if(isGestor(S.role)) cards.push({id:"gestao",ic:"👥",nome:"Gestão",desc:"Unidades, moradores e equipe",on:true});
  let html=`<div class="h">Serviços <small>Tudo do seu condomínio em um lugar</small></div><div class="hub">`;
  html+=cards.map(c=>`<button class="hubcard ${c.on?"":"soon"}" ${c.on?`data-goto="${c.id}"`:""}>
      <span class="ic">${c.ic}</span><b>${c.nome}</b><small>${esc(c.desc)}</small>
      ${c.on?"":'<span class="tag">em breve</span>'}</button>`).join("");
  html+=`</div>`;
  view().innerHTML=html; $("#fab").classList.add("hide");
  view().querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.goto)));
}

// ===================================================================
// MÓDULO: VEÍCULOS & PETS (cadastros da unidade)
// ===================================================================
const VEIC_TIPO={carro:"🚗 Carro",moto:"🏍️ Moto",bicicleta:"🚲 Bicicleta",outro:"🚙 Outro"};
const PET_ESPECIE={cao:"🐶 Cão",gato:"🐱 Gato",ave:"🐦 Ave",roedor:"🐹 Roedor",outro:"🐾 Outro"};
const PET_PORTE={pequeno:"Pequeno",medio:"Médio",grande:"Grande"};
function subhead(titulo){ return `<div class="subhead"><button class="back" id="voltarServ" aria-label="Voltar">←</button><div class="h" style="margin:0">${titulo}</div></div>`; }

async function renderCadastros(){
  view().innerHTML=subhead("Veículos & Pets <small>Cadastros da sua unidade</small>")+'<div class="spin"></div>';
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#fab").classList.add("hide");
  const unid=S.unidadeId;
  if(!unid){
    $("#view .spin")?.replaceWith(document.createRange().createContextualFragment(
      emptyBox("🏠","Sem unidade vinculada","Peça ao síndico para vincular sua conta a uma unidade para cadastrar veículos e pets.")));
    return;
  }
  const [{data:veics},{data:pets}]=await Promise.all([
    sb.from("veiculos").select("*").eq("condominio_id",S.condId).eq("unidade_id",unid).order("created_at"),
    sb.from("pets").select("*").eq("condominio_id",S.condId).eq("unidade_id",unid).order("created_at")
  ]);
  let html=subhead("Veículos & Pets <small>Cadastros da sua unidade</small>");
  // Veículos
  html+=`<div class="row" style="display:flex;align-items:center;margin:6px 2px 8px"><b style="flex:1;font-size:15px">🚗 Veículos</b>
    <button class="badge" id="addVeic" style="cursor:pointer">＋ Adicionar</button></div>`;
  html+=(veics&&veics.length)?veics.map(v=>`<div class="tile" style="padding:14px">
      <div class="row"><h3 style="flex:1;font-size:15px">${esc(v.placa)}</h3><span class="badge">${VEIC_TIPO[v.tipo]||v.tipo}</span></div>
      <div class="meta">${v.modelo?`<span>${esc(v.modelo)}</span>`:""}${v.cor?`<span>🎨 ${esc(v.cor)}</span>`:""}${v.vaga?`<span>🅿️ ${esc(v.vaga)}</span>`:""}</div>
      <div class="meta"><button class="badge" data-ev="${v.id}" style="cursor:pointer">✏️ Editar</button><button class="badge cancelada" data-dv="${v.id}" style="cursor:pointer">🗑️ Remover</button></div>
    </div>`).join(""):'<p class="sub" style="margin:0 2px 12px">Nenhum veículo cadastrado.</p>';
  // Pets
  html+=`<div class="row" style="display:flex;align-items:center;margin:16px 2px 8px"><b style="flex:1;font-size:15px">🐾 Pets</b>
    <button class="badge" id="addPet" style="cursor:pointer">＋ Adicionar</button></div>`;
  html+=(pets&&pets.length)?pets.map(p=>`<div class="tile" style="padding:14px">
      <div class="row"><h3 style="flex:1;font-size:15px">${esc(p.nome)}</h3><span class="badge">${PET_ESPECIE[p.especie]||p.especie}</span></div>
      <div class="meta">${p.porte?`<span>${PET_PORTE[p.porte]}</span>`:""}${p.cor?`<span>🎨 ${esc(p.cor)}</span>`:""}${p.observacao?`<span>${esc(p.observacao)}</span>`:""}</div>
      <div class="meta"><button class="badge" data-ep="${p.id}" style="cursor:pointer">✏️ Editar</button><button class="badge cancelada" data-dp="${p.id}" style="cursor:pointer">🗑️ Remover</button></div>
    </div>`).join(""):'<p class="sub" style="margin:0 2px 12px">Nenhum pet cadastrado.</p>';
  view().innerHTML=html;
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#addVeic").addEventListener("click",()=>formVeiculo());
  $("#addPet").addEventListener("click",()=>formPet());
  view().querySelectorAll("[data-ev]").forEach(b=>b.addEventListener("click",()=>formVeiculo((veics||[]).find(v=>v.id===b.dataset.ev))));
  view().querySelectorAll("[data-ep]").forEach(b=>b.addEventListener("click",()=>formPet((pets||[]).find(p=>p.id===b.dataset.ep))));
  view().querySelectorAll("[data-dv]").forEach(b=>b.addEventListener("click",async()=>{
    if(!await confirmar("Remover este veículo?","Remover")) return;
    try{ await rpc("veiculo_excluir",{p_id:b.dataset.dv}); toast("Veículo removido"); renderCadastros(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-dp]").forEach(b=>b.addEventListener("click",async()=>{
    if(!await confirmar("Remover este pet?","Remover")) return;
    try{ await rpc("pet_excluir",{p_id:b.dataset.dp}); toast("Pet removido"); renderCadastros(); }catch(e){ toast(e.message); }
  }));
}
function formVeiculo(v){
  const tipos=Object.entries(VEIC_TIPO).map(([k,l])=>`<button data-t="${k}" class="${(v?v.tipo:'carro')===k?'on':''}">${l}</button>`).join("");
  let tipo=v?v.tipo:'carro';
  sheet(`<h2>${v?"Editar veículo":"Novo veículo"}</h2>
    <label>Tipo</label><div class="seg" id="vTipo">${tipos}</div>
    <label>Placa</label><input id="vPlaca" class="field" style="text-transform:uppercase" maxlength="8" placeholder="ABC1D23" value="${v?esc(v.placa):""}">
    <label>Modelo (opcional)</label><input id="vModelo" class="field" placeholder="Ex.: Onix prata" value="${v&&v.modelo?esc(v.modelo):""}">
    <div style="display:flex;gap:10px"><div style="flex:1"><label>Cor (opcional)</label><input id="vCor" class="field" placeholder="Prata" value="${v&&v.cor?esc(v.cor):""}"></div>
      <div style="flex:1"><label>Vaga (opcional)</label><input id="vVaga" class="field" placeholder="G1-23" value="${v&&v.vaga?esc(v.vaga):""}"></div></div>
    <button class="btn" id="vSave">${v?"Salvar":"Adicionar"}</button>`);
  $("#vTipo").querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{ tipo=b.dataset.t; $("#vTipo").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); }));
  $("#vSave").addEventListener("click",async()=>{
    const placa=$("#vPlaca").value.trim(); if(!placa) return toast("Informe a placa.");
    $("#vSave").disabled=true;
    try{
      await rpc("veiculo_salvar",{p_cond:S.condId,p_unidade:S.unidadeId,p_placa:placa,
        p_modelo:$("#vModelo").value.trim()||null,p_cor:$("#vCor").value.trim()||null,p_tipo:tipo,
        p_vaga:$("#vVaga").value.trim()||null,p_id:v?v.id:null});
      closeSheet(); toast("Veículo salvo 🚗"); renderCadastros();
    }catch(e){ $("#vSave").disabled=false; toast(e.message); }
  });
}
function formPet(p){
  const esp=Object.entries(PET_ESPECIE).map(([k,l])=>`<button data-e="${k}" class="${(p?p.especie:'cao')===k?'on':''}">${l}</button>`).join("");
  const portes=[["","—"],["pequeno","Pequeno"],["medio","Médio"],["grande","Grande"]].map(([k,l])=>`<option value="${k}" ${(p&&p.porte||"")===k?"selected":""}>${l}</option>`).join("");
  let especie=p?p.especie:'cao';
  sheet(`<h2>${p?"Editar pet":"Novo pet"}</h2>
    <label>Espécie</label><div class="seg" id="pEsp">${esp}</div>
    <label>Nome</label><input id="pNome" class="field" placeholder="Ex.: Thor" value="${p?esc(p.nome):""}">
    <div style="display:flex;gap:10px"><div style="flex:1"><label>Porte</label><select id="pPorte" class="field">${portes}</select></div>
      <div style="flex:1"><label>Cor (opcional)</label><input id="pCor" class="field" placeholder="Caramelo" value="${p&&p.cor?esc(p.cor):""}"></div></div>
    <label>Observação (opcional)</label><input id="pObs" class="field" placeholder="Ex.: idoso, dócil" value="${p&&p.observacao?esc(p.observacao):""}">
    <button class="btn" id="pSave">${p?"Salvar":"Adicionar"}</button>`);
  $("#pEsp").querySelectorAll("[data-e]").forEach(b=>b.addEventListener("click",()=>{ especie=b.dataset.e; $("#pEsp").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); }));
  $("#pSave").addEventListener("click",async()=>{
    const nome=$("#pNome").value.trim(); if(!nome) return toast("Informe o nome do pet.");
    $("#pSave").disabled=true;
    try{
      await rpc("pet_salvar",{p_cond:S.condId,p_unidade:S.unidadeId,p_nome:nome,p_especie:especie,
        p_porte:$("#pPorte").value||null,p_cor:$("#pCor").value.trim()||null,p_obs:$("#pObs").value.trim()||null,p_id:p?p.id:null});
      closeSheet(); toast("Pet salvo 🐾"); renderCadastros();
    }catch(e){ $("#pSave").disabled=false; toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: VAGAS (garagem — gestão)
// ===================================================================
const VAGA_TIPO={coberta:"Coberta",descoberta:"Descoberta",moto:"Moto",deficiente:"PCD"};
async function renderVagas(){
  view().innerHTML=subhead("Vagas <small>Garagem do condomínio</small>")+'<div class="spin"></div>';
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#fab").classList.add("hide");
  const gestor=isGestor(S.role);
  const [{data:vagas},{data:unids}]=await Promise.all([
    sb.from("vagas").select("*").eq("condominio_id",S.condId).order("identificacao"),
    sb.from("unidades").select("id,bloco,numero").eq("condominio_id",S.condId).order("numero")
  ]);
  S._unidsVaga=unids||[];
  const unMap={}; (unids||[]).forEach(u=>unMap[u.id]=unitLabel(u.bloco,u.numero));
  let html=subhead("Vagas <small>Garagem do condomínio</small>");
  if(gestor) html+=`<button class="btn secondary" id="addVaga" style="margin:0 0 12px">＋ Nova vaga</button>`;
  html+=(vagas&&vagas.length)?vagas.map(v=>`<div class="tile" style="padding:14px">
      <div class="row"><h3 style="flex:1;font-size:15px">🅿️ ${esc(v.identificacao)}</h3><span class="badge">${VAGA_TIPO[v.tipo]||v.tipo}</span></div>
      <div class="meta"><span>${v.unidade_id&&unMap[v.unidade_id]?"🏠 "+esc(unMap[v.unidade_id]):"Livre / não atribuída"}</span>${v.observacao?`<span>${esc(v.observacao)}</span>`:""}</div>
      ${gestor?`<div class="meta"><button class="badge" data-eg="${v.id}" style="cursor:pointer">✏️ Editar</button><button class="badge cancelada" data-dg="${v.id}" style="cursor:pointer">🗑️ Remover</button></div>`:""}
    </div>`).join(""):emptyBox("🅿️","Nenhuma vaga cadastrada.",gestor?"Toque em “Nova vaga” para começar.":"");
  view().innerHTML=html;
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#addVaga")?.addEventListener("click",()=>formVaga());
  view().querySelectorAll("[data-eg]").forEach(b=>b.addEventListener("click",()=>formVaga((vagas||[]).find(v=>v.id===b.dataset.eg))));
  view().querySelectorAll("[data-dg]").forEach(b=>b.addEventListener("click",async()=>{
    if(!await confirmar("Remover esta vaga?","Remover")) return;
    try{ await rpc("vaga_excluir",{p_id:b.dataset.dg}); toast("Vaga removida"); renderVagas(); }catch(e){ toast(e.message); }
  }));
}
function formVaga(v){
  const tipos=Object.entries(VAGA_TIPO).map(([k,l])=>`<option value="${k}" ${(v?v.tipo:'descoberta')===k?"selected":""}>${l}</option>`).join("");
  const unopts=`<option value="">Livre / não atribuída</option>`+(S._unidsVaga||[]).map(u=>`<option value="${u.id}" ${v&&v.unidade_id===u.id?"selected":""}>${esc(unitLabel(u.bloco,u.numero))}</option>`).join("");
  sheet(`<h2>${v?"Editar vaga":"Nova vaga"}</h2>
    <label>Identificação</label><input id="gIdent" class="field" placeholder="G1-23" value="${v?esc(v.identificacao):""}">
    <div style="display:flex;gap:10px"><div style="flex:1"><label>Tipo</label><select id="gTipo" class="field">${tipos}</select></div>
      <div style="flex:1"><label>Unidade</label><select id="gUnid" class="field">${unopts}</select></div></div>
    <label>Observação (opcional)</label><input id="gObs" class="field" placeholder="Ex.: ao lado do elevador" value="${v&&v.observacao?esc(v.observacao):""}">
    <button class="btn" id="gSave">${v?"Salvar":"Adicionar"}</button>`);
  $("#gSave").addEventListener("click",async()=>{
    const ident=$("#gIdent").value.trim(); if(!ident) return toast("Informe a identificação.");
    $("#gSave").disabled=true;
    try{
      await rpc("vaga_salvar",{p_cond:S.condId,p_ident:ident,p_unidade:$("#gUnid").value||null,
        p_tipo:$("#gTipo").value,p_obs:$("#gObs").value.trim()||null,p_id:v?v.id:null});
      closeSheet(); toast("Vaga salva 🅿️"); renderVagas();
    }catch(e){ $("#gSave").disabled=false; toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: AUTORIZAÇÕES PERMANENTES (pré-liberações recorrentes / delivery)
// ===================================================================
const AUT_TIPO={recorrente:"Visitante recorrente",diarista:"Diarista",baba:"Babá",cuidador:"Cuidador(a)",prestador:"Prestador",delivery:"Delivery",outro:"Outro"};
const AUT_IC={recorrente:"🔁",diarista:"🧹",baba:"👶",cuidador:"🧑‍⚕️",prestador:"🔧",delivery:"🛵",outro:"🔓"};
const DIAS_SEM=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
function diasLabel(dias){ if(!dias||!dias.length) return "Qualquer dia"; return dias.slice().sort().map(d=>DIAS_SEM[d]).join(", "); }
function autVigente(a){ return a.ativo && (!a.validade_ate || new Date(a.validade_ate)>=new Date(new Date().toDateString())); }

async function renderAutorizacoes(){
  view().innerHTML=subhead("Autorizações <small>Pré-liberações recorrentes</small>")+'<div class="spin"></div>';
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#fab").classList.add("hide");
  const portaria=isPortaria(S.role)&&!S.unidadeId; // portaria pura vê tudo por unidade
  const {data:unids}=await sb.from("unidades").select("id,bloco,numero").eq("condominio_id",S.condId).order("numero");
  const unMap={}; (unids||[]).forEach(u=>unMap[u.id]=unitLabel(u.bloco,u.numero));
  let q=sb.from("autorizacoes").select("*").eq("condominio_id",S.condId).order("created_at",{ascending:false});
  const {data:auts}=await q;
  const list=auts||[];
  let html=subhead("Autorizações <small>Pré-liberações recorrentes</small>");
  html+=`<p class="sub" style="margin:0 2px 12px">Libere pessoas e serviços recorrentes (diarista, babá, delivery…) para a portaria sem gerar um código toda vez.</p>`;
  if(S.unidadeId) html+=`<button class="btn secondary" id="addAut" style="margin:0 0 14px">＋ Nova autorização</button>`;
  const vig=list.filter(autVigente), inativas=list.filter(a=>!autVigente(a));
  const card=a=>`<div class="tile" style="padding:14px">
      <div class="row"><span style="font-size:20px">${AUT_IC[a.tipo]||"🔓"}</span>
        <h3 style="flex:1;font-size:15px">${esc(a.nome)}</h3>
        <span class="badge ${autVigente(a)?"autorizado":"cancelada"}">${AUT_TIPO[a.tipo]||a.tipo}</span></div>
      <div class="meta">${(portaria||!S.unidadeId)&&a.unidade_id&&unMap[a.unidade_id]?`<span>🏠 ${esc(unMap[a.unidade_id])}</span>`:""}
        <span>📅 ${diasLabel(a.dias)}</span>
        <span>⏳ ${a.validade_ate?("até "+new Date(a.validade_ate).toLocaleDateString("pt-BR")):"sem prazo"}</span>
        ${a.documento?`<span>🪪 ${esc(a.documento)}</span>`:""}${a.telefone?`<span>📞 ${esc(a.telefone)}</span>`:""}</div>
      ${a.observacao?`<p style="margin-top:8px">${esc(a.observacao)}</p>`:""}
      ${(S.unidadeId||isGestor(S.role))?`<div class="meta">
        <button class="badge" data-ea="${a.id}" style="cursor:pointer">✏️ Editar</button>
        ${autVigente(a)?`<button class="badge cancelada" data-ra="${a.id}" style="cursor:pointer">⏸️ Revogar</button>`
                       :`<button class="badge" data-aa="${a.id}" style="cursor:pointer">▶️ Reativar</button>`}
        <button class="badge cancelada" data-xa="${a.id}" style="cursor:pointer">🗑️</button></div>`:""}
    </div>`;
  if(!list.length){ html+=emptyBox("🔓","Nenhuma autorização","Cadastre quem pode entrar de forma recorrente."); }
  else{
    html+=`<label>✅ Vigentes</label>`+(vig.length?vig.map(card).join(""):'<p class="sub">Nenhuma vigente.</p>');
    if(inativas.length) html+=`<label style="margin-top:16px">⏸️ Revogadas / expiradas</label>`+inativas.map(card).join("");
  }
  view().innerHTML=html;
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#addAut")?.addEventListener("click",()=>formAutorizacao());
  view().querySelectorAll("[data-ea]").forEach(b=>b.addEventListener("click",()=>formAutorizacao(list.find(a=>a.id===b.dataset.ea))));
  view().querySelectorAll("[data-ra]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("autorizacao_revogar",{p_id:b.dataset.ra,p_reativar:false}); toast("Autorização revogada"); renderAutorizacoes(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-aa]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("autorizacao_revogar",{p_id:b.dataset.aa,p_reativar:true}); toast("Autorização reativada"); renderAutorizacoes(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-xa]").forEach(b=>b.addEventListener("click",async()=>{
    if(!await confirmar("Excluir esta autorização definitivamente?","Excluir")) return;
    try{ await rpc("autorizacao_excluir",{p_id:b.dataset.xa}); toast("Excluída"); renderAutorizacoes(); }catch(e){ toast(e.message); }
  }));
}
function formAutorizacao(a){
  const tipos=Object.entries(AUT_TIPO).map(([k,l])=>`<option value="${k}" ${(a?a.tipo:'recorrente')===k?"selected":""}>${AUT_IC[k]} ${l}</option>`).join("");
  const diasSel=new Set(a&&a.dias?a.dias:[]);
  const diasBtns=DIAS_SEM.map((d,i)=>`<button data-d="${i}" class="${diasSel.has(i)?'on':''}">${d}</button>`).join("");
  sheet(`<h2>${a?"Editar autorização":"Nova autorização"}</h2>
    <label>Tipo</label><select id="aTipo" class="field">${tipos}</select>
    <label>Nome</label><input id="aNome" class="field" placeholder="Ex.: Maria (diarista)" value="${a?esc(a.nome):""}">
    <div style="display:flex;gap:10px"><div style="flex:1"><label>Documento (opcional)</label><input id="aDoc" class="field" placeholder="RG/CPF" value="${a&&a.documento?esc(a.documento):""}"></div>
      <div style="flex:1"><label>Telefone (opcional)</label><input id="aTel" class="field" inputmode="tel" placeholder="(00) 90000-0000" value="${a&&a.telefone?esc(a.telefone):""}"></div></div>
    <label>Dias liberados <small style="font-weight:400;color:var(--muted)">(nenhum = qualquer dia)</small></label>
    <div class="seg" id="aDias">${diasBtns}</div>
    <label>Válido até (opcional)</label><input id="aVal" class="field" type="date" value="${a&&a.validade_ate?a.validade_ate:""}">
    <label>Observação (opcional)</label><input id="aObs" class="field" placeholder="Ex.: entra pela garagem" value="${a&&a.observacao?esc(a.observacao):""}">
    <button class="btn" id="aSave">${a?"Salvar":"Adicionar"}</button>`);
  $("#aDias").querySelectorAll("[data-d]").forEach(b=>b.addEventListener("click",()=>{
    const d=+b.dataset.d; if(diasSel.has(d)) diasSel.delete(d); else diasSel.add(d); b.classList.toggle("on");
  }));
  $("#aSave").addEventListener("click",async()=>{
    const nome=$("#aNome").value.trim(); if(!nome) return toast("Informe o nome.");
    $("#aSave").disabled=true;
    try{
      await rpc("autorizacao_salvar",{p_cond:S.condId,p_unidade:S.unidadeId,p_nome:nome,p_tipo:$("#aTipo").value,
        p_documento:$("#aDoc").value.trim()||null,p_telefone:$("#aTel").value.trim()||null,
        p_dias:[...diasSel].sort(),p_validade:$("#aVal").value||null,p_obs:$("#aObs").value.trim()||null,p_id:a?a.id:null});
      closeSheet(); toast("Autorização salva 🔓"); renderAutorizacoes();
    }catch(e){ $("#aSave").disabled=false; toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: CONVERSAS (canal direto morador ↔ gestão / portaria)
// ===================================================================
const CONV_DEST={gestao:"Gestão",portaria:"Portaria"};
let _convPoll=null, _convId=null;
function pararConvPoll(){ if(_convPoll){ clearInterval(_convPoll); _convPoll=null; } }

async function renderConversas(){
  pararConvPoll(); _convId=null;
  view().innerHTML=subhead("Mensagens <small>Fale com a gestão ou a portaria</small>")+'<div class="spin"></div>';
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#fab").classList.add("hide");
  const {data:convs}=await sb.from("conversas").select("*, unidades(bloco,numero)").eq("condominio_id",S.condId).order("updated_at",{ascending:false});
  const list=convs||[];
  let html=subhead("Mensagens <small>Fale com a gestão ou a portaria</small>");
  html+=`<button class="btn secondary" id="novaConv" style="margin:0 0 14px">＋ Nova conversa</button>`;
  html+= list.length? list.map(c=>{
    const un=c.unidades?unitLabel(c.unidades.bloco,c.unidades.numero):null;
    const mine=c.aberta_por===S.user.id;
    return `<div class="tile" data-conv="${c.id}" style="cursor:pointer">
      <div class="row"><span style="font-size:20px">${c.destino==="portaria"?"🛎️":"🏢"}</span>
        <h3 style="flex:1;font-size:15px">${esc(c.assunto)}</h3>
        <span class="badge ${c.status==="aberta"?"aberta":"cancelada"}">${c.status==="aberta"?"Aberta":"Fechada"}</span></div>
      <div class="meta"><span>➡️ ${CONV_DEST[c.destino]||c.destino}</span>${!mine&&un?`<span>🏠 ${esc(un)}</span>`:""}<span>🕒 ${fmtDate(c.updated_at)}</span></div>
    </div>`;
  }).join("") : emptyBox("💬","Nenhuma conversa ainda","Toque em “Nova conversa” para falar com a gestão ou a portaria.");
  view().innerHTML=html;
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#novaConv").addEventListener("click",novaConversa);
  view().querySelectorAll("[data-conv]").forEach(b=>b.addEventListener("click",()=>abrirConversa(b.dataset.conv)));
}
function novaConversa(){
  const canPortaria=true;
  let destino="gestao";
  sheet(`<h2>Nova conversa</h2>
    <label>Para</label>
    <div class="seg" id="cvDest">
      <button data-x="gestao" class="on">🏢 Gestão (síndico)</button>
      <button data-x="portaria">🛎️ Portaria</button>
    </div>
    <label>Assunto</label><input id="cvAssunto" class="field" placeholder="Ex.: Barulho no 3º andar">
    <label>Mensagem</label><textarea id="cvCorpo" class="field" rows="4" placeholder="Escreva sua mensagem..."></textarea>
    <button class="btn" id="cvSend">Enviar</button>`);
  $("#cvDest").querySelectorAll("[data-x]").forEach(b=>b.addEventListener("click",()=>{ destino=b.dataset.x; $("#cvDest").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); }));
  $("#cvSend").addEventListener("click",async()=>{
    const assunto=$("#cvAssunto").value.trim(), corpo=$("#cvCorpo").value.trim();
    if(!assunto) return toast("Informe o assunto."); if(!corpo) return toast("Escreva a mensagem.");
    $("#cvSend").disabled=true;
    try{
      const id=await rpc("conversa_abrir",{p_cond:S.condId,p_destino:destino,p_assunto:assunto,p_corpo:corpo});
      closeSheet(); toast("Conversa iniciada 💬"); abrirConversa(id);
    }catch(e){ $("#cvSend").disabled=false; toast(e.message); }
  });
}
async function abrirConversa(id){
  pararConvPoll(); _convId=id;
  view().innerHTML=subhead("Conversa")+'<div class="spin"></div>';
  $("#voltarServ")?.addEventListener("click",()=>go("conversas"));
  $("#fab").classList.add("hide");
  const {data:conv}=await sb.from("conversas").select("*, unidades(bloco,numero)").eq("id",id).single();
  if(!conv){ toast("Conversa não encontrada."); return go("conversas"); }
  const unLbl=conv.unidades?unitLabel(conv.unidades.bloco,conv.unidades.numero):"Morador";
  const staffLbl=CONV_DEST[conv.destino]||conv.destino;
  const fechada=conv.status==="fechada";
  let html=`<div class="subhead"><button class="back" id="voltarConv" aria-label="Voltar">←</button>
      <div class="h" style="margin:0;flex:1;min-width:0"><span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(conv.assunto)}</span>
      <small>➡️ ${staffLbl}${fechada?" · fechada":""}</small></div>
      <button class="badge" id="convToggle" style="cursor:pointer;flex:0 0 auto">${fechada?"▶️ Reabrir":"✔️ Encerrar"}</button></div>
    <div class="chat" id="chatBox"><div class="spin"></div></div>
    <div class="composer"><textarea id="msgInput" rows="1" placeholder="Escreva uma mensagem..."></textarea>
      <button class="send" id="msgSend" aria-label="Enviar">➤</button></div>`;
  view().innerHTML=html;
  $("#voltarConv").addEventListener("click",()=>go("conversas"));
  $("#convToggle").addEventListener("click",async()=>{
    try{ await rpc("conversa_definir_status",{p_conversa:id,p_status:fechada?"aberta":"fechada"}); abrirConversa(id); }catch(e){ toast(e.message); }
  });
  const meId=S.user.id, openerId=conv.aberta_por;
  async function carregar(scroll){
    const {data:msgs}=await sb.from("mensagens").select("*").eq("conversa_id",id).order("created_at");
    const box=$("#chatBox"); if(!box) return;
    box.innerHTML=(msgs||[]).map(m=>{
      const me=m.autor_id===meId;
      const who=me?"Você":(m.autor_id===openerId?unLbl:staffLbl);
      return `<div class="bubble ${me?"me":"them"}">${me?"":`<span class="who">${esc(who)}</span>`}${esc(m.corpo)}<span class="t">${fmtDate(m.created_at)}</span></div>`;
    }).join("")||'<p class="sub">Sem mensagens.</p>';
    if(scroll) box.lastElementChild?.scrollIntoView({block:"end"});
  }
  await carregar(true);
  const ta=$("#msgInput");
  ta.addEventListener("input",()=>{ ta.style.height="auto"; ta.style.height=Math.min(ta.scrollHeight,120)+"px"; });
  async function enviar(){
    const corpo=ta.value.trim(); if(!corpo) return;
    $("#msgSend").disabled=true;
    try{
      await rpc("mensagem_enviar",{p_conversa:id,p_corpo:corpo});
      ta.value=""; ta.style.height="auto"; await carregar(true);
    }catch(e){ toast(e.message); }
    $("#msgSend").disabled=false; ta.focus();
  }
  $("#msgSend").addEventListener("click",enviar);
  ta.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); enviar(); } });
  // atualização leve enquanto a conversa estiver aberta
  pararConvPoll();
  _convPoll=setInterval(()=>{ if(S.tab!=="conversas"||_convId!==id){ pararConvPoll(); return; } carregar(false); },12000);
}

// ===================================================================
// MÓDULO: SATISFAÇÃO / NPS
// ===================================================================
async function renderPesquisas(){
  view().innerHTML=subhead("Satisfação <small>Pesquisas e NPS</small>")+'<div class="spin"></div>';
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#fab").classList.add("hide");
  const gestor=isGestor(S.role);
  const {data:pesqs}=await sb.from("pesquisas").select("*").eq("condominio_id",S.condId).order("created_at",{ascending:false});
  const list=pesqs||[];
  const results={};
  await Promise.all(list.map(async p=>{ try{ results[p.id]=await rpc("pesquisa_resultado",{p_pesquisa:p.id}); }catch(_){ results[p.id]={}; } }));
  let html=subhead("Satisfação <small>Pesquisas e NPS</small>");
  if(gestor) html+=`<button class="btn secondary" id="novaPesq" style="margin:0 0 14px">＋ Nova pesquisa</button>`;
  if(!list.length){ html+=emptyBox("⭐","Nenhuma pesquisa",gestor?"Crie uma pesquisa de satisfação (NPS).":"Quando a gestão abrir uma pesquisa, aparece aqui."); }
  else html+=list.map(p=>{
    const r=results[p.id]||{}; const nps=r.nps;
    const npsColor=nps==null?"var(--muted)":nps>=50?"var(--ok)":nps>=0?"var(--warn)":"var(--danger)";
    const meu=r.meu_voto;
    const notas=Array.from({length:11},(_,i)=>`<button class="npsbtn ${meu===i?"on":""}" data-nota="${p.id}:${i}" ${p.ativa?"":"disabled"}>${i}</button>`).join("");
    return `<div class="tile">
      <div class="row"><h3 style="flex:1;font-size:15px">${esc(p.titulo)}</h3><span class="badge ${p.ativa?"aberta":"cancelada"}">${p.ativa?"Aberta":"Encerrada"}</span></div>
      <p style="margin-top:4px">${esc(p.pergunta)}</p>
      ${p.ativa?`<div class="npsrow" id="nps-${p.id}">${notas}</div>
        <input class="field npc" id="npc-${p.id}" placeholder="Comentário (opcional)" style="margin-top:8px">
        <div class="sub" style="margin-top:6px">${meu!=null?`Seu voto: <b>${meu}</b> — toque para alterar`:"Toque na sua nota de 0 a 10"}</div>`:""}
      <div style="margin-top:10px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <div><div style="font-size:26px;font-weight:800;color:${npsColor};line-height:1">${nps==null?"—":nps}</div><small class="sub">NPS</small></div>
        <div class="sub">${r.total||0} resposta(s) · média ${r.media??"—"}<br>👍 ${r.promotores||0} · 😐 ${r.neutros||0} · 👎 ${r.detratores||0}</div>
      </div>
      ${gestor?`<div class="meta" style="margin-top:8px">
        <button class="badge" data-pesqativa="${p.id}:${p.ativa?0:1}" style="cursor:pointer">${p.ativa?"⏹️ Encerrar":"▶️ Reabrir"}</button>
        ${(r.comentarios&&r.comentarios.length)?`<button class="badge" data-pesqcom="${p.id}" style="cursor:pointer">💬 ${r.comentarios.length} comentário(s)</button>`:""}</div>`:""}
    </div>`;
  }).join("");
  view().innerHTML=html;
  $("#voltarServ")?.addEventListener("click",()=>go("servicos"));
  $("#novaPesq")?.addEventListener("click",novaPesquisa);
  view().querySelectorAll("[data-nota]").forEach(b=>b.addEventListener("click",async()=>{
    const [pid,nota]=b.dataset.nota.split(":");
    const com=($("#npc-"+pid)?.value||"").trim();
    try{ await rpc("pesquisa_responder",{p_pesquisa:pid,p_nota:Number(nota),p_comentario:com||null}); toast("Voto registrado ⭐"); renderPesquisas(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-pesqativa]").forEach(b=>b.addEventListener("click",async()=>{
    const [pid,ativa]=b.dataset.pesqativa.split(":");
    try{ await rpc("pesquisa_definir_ativa",{p_pesquisa:pid,p_ativa:ativa==="1"}); renderPesquisas(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-pesqcom]").forEach(b=>b.addEventListener("click",()=>{
    const r=results[b.dataset.pesqcom]||{}; const coms=r.comentarios||[];
    sheet(`<h2>Comentários</h2>${coms.length?coms.map(c=>`<div class="tile" style="padding:12px"><div class="row"><span class="badge ${c.nota>=9?"resolvida":c.nota<=6?"cancelada":""}">Nota ${c.nota}</span></div><p style="margin-top:6px">${esc(c.comentario)}</p></div>`).join(""):'<p class="sub">Sem comentários.</p>'}`);
  }));
}
function novaPesquisa(){
  sheet(`<h2>Nova pesquisa</h2>
    <label>Título</label><input id="npTit" class="field" placeholder="Ex.: Satisfação — 1º semestre">
    <label>Pergunta</label><input id="npPerg" class="field" placeholder="De 0 a 10, quanto você recomendaria morar aqui?">
    <button class="btn" id="npSave">Criar</button>`);
  $("#npSave").addEventListener("click",async()=>{
    const t=$("#npTit").value.trim(); if(!t) return toast("Informe o título.");
    $("#npSave").disabled=true;
    try{ await rpc("pesquisa_criar",{p_cond:S.condId,p_titulo:t,p_pergunta:$("#npPerg").value.trim()||null});
      closeSheet(); toast("Pesquisa criada ⭐"); renderPesquisas();
    }catch(e){ $("#npSave").disabled=false; toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: RESERVAS (áreas comuns)
// ===================================================================
const RESV_STATUS = {pendente:"Pendente",aprovada:"Aprovada",rejeitada:"Recusada",cancelada:"Cancelada"};
const resvBadge = s => ({pendente:"em_andamento",aprovada:"resolvida",rejeitada:"cancelada",cancelada:"cancelada"}[s]||"");
function fmtRange(iniISO,fimISO){
  const i=new Date(iniISO), f=new Date(fimISO);
  const dia=d=>d.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"});
  const hora=d=>d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  return i.toDateString()===f.toDateString()
    ? `${dia(i)}, ${hora(i)}–${hora(f)}`
    : `${dia(i)} ${hora(i)} → ${dia(f)} ${hora(f)}`;
}
function reservaCard(r,opts={}){
  const un=r.unidades?`${r.unidades.bloco?r.unidades.bloco+" ":""}${r.unidades.numero}`:"";
  return `<div class="tile" style="padding:14px">
    <div class="row"><h3 style="flex:1;font-size:15px">${esc(r.areas?.nome||"Área")}</h3>
      <span class="badge ${resvBadge(r.status)}">${RESV_STATUS[r.status]||r.status}</span></div>
    <div class="meta"><span>🕒 ${fmtRange(r.inicio,r.fim)}</span>${un?`<span>🏠 ${esc(un)}</span>`:""}</div>
    ${r.observacao?`<p>${esc(r.observacao)}</p>`:""}
    ${r.motivo_decisao?`<p class="sub" style="margin-top:6px">Motivo: ${esc(r.motivo_decisao)}</p>`:""}
    ${opts.aprovar?`<div class="seg" style="margin-top:10px">
      <button class="btn" data-aprovar="${r.id}" style="width:auto;margin:0;padding:9px 16px">✅ Aprovar</button>
      <button class="btn secondary" data-rejeitar="${r.id}" style="width:auto;margin:0;padding:9px 16px">Recusar</button></div>`:""}
    ${opts.cancelar?`<button class="badge" data-cancelr="${r.id}" style="margin-top:10px;background:#fdecea;color:var(--danger)">Cancelar</button>`:""}
  </div>`;
}
async function renderReservas(){
  loading();
  let areas=[], reservas=[];
  try{
    const [a,r]=await Promise.all([
      sb.from("areas").select("*").eq("condominio_id",S.condId).eq("ativo",true).order("nome"),
      sb.from("reservas").select("*, areas(nome), unidades(bloco,numero)").eq("condominio_id",S.condId).order("inicio")
    ]);
    areas=a.data||[]; reservas=r.data||[];
  }catch(e){ view().innerHTML=`<p class="empty">Erro: ${esc(e.message)}</p>`; return; }
  S._areas=areas;
  const gestor=isGestor(S.role), agora=Date.now();

  let html=`<div class="subhead"><button class="back" id="rBack">‹</button>
    <div class="h" style="margin:0">Reservas <small>Áreas comuns do condomínio</small></div></div>`;
  if(isSindico(S.role)) html+=`<button class="btn secondary" id="rAddArea" style="margin-bottom:14px">➕ Nova área</button>`;

  if(gestor){
    const pend=reservas.filter(r=>r.status==="pendente");
    if(pend.length){
      html+=`<label style="margin-top:4px">⏳ Aprovações pendentes (${pend.length})</label>`;
      html+=pend.map(r=>reservaCard(r,{aprovar:true})).join("");
    }
  }

  html+=`<label style="margin-top:8px">🏛️ Áreas disponíveis</label>`;
  if(!areas.length){
    html+=emptyBox("📅","Nenhuma área cadastrada.",isSindico(S.role)?"Toque em ➕ Nova área para começar.":"O síndico ainda não cadastrou áreas reserváveis.");
  }else{
    html+=areas.map(a=>{
      const prox=reservas.filter(r=>r.area_id===a.id && r.status==="aprovada" && new Date(r.fim).getTime()>=agora).slice(0,3);
      return `<div class="tile">
        <div class="row"><h3 style="flex:1">${esc(a.nome)}</h3>
          ${a.requer_aprovacao?'<span class="badge">Requer aprovação</span>':'<span class="badge resolvida">Automática</span>'}</div>
        ${a.descricao?`<p>${esc(a.descricao)}</p>`:""}
        <div class="meta">${a.capacidade?`<span>👥 até ${a.capacidade}</span>`:""}${a.taxa?`<span>💰 R$ ${Number(a.taxa).toFixed(2)}</span>`:""}${a.hora_abertura?`<span>🕒 ${a.hora_abertura.slice(0,5)}–${(a.hora_fechamento||"").slice(0,5)}</span>`:""}${a.max_por_mes_unidade?`<span>📅 até ${a.max_por_mes_unidade}/mês</span>`:""}${a.antecedencia_min_horas?`<span>⏱️ antec. ${a.antecedencia_min_horas}h</span>`:""}</div>
        ${prox.length?`<div class="meta" style="flex-direction:column;align-items:flex-start;gap:4px;margin-top:8px">${prox.map(r=>`<span>📌 ${fmtRange(r.inicio,r.fim)}</span>`).join("")}</div>`:""}
        <button class="btn" data-reservar="${a.id}" style="margin-top:12px">Reservar</button>
        ${isSindico(S.role)?`<button class="badge" data-bloq="${a.id}" style="margin-top:8px">🚫 Datas bloqueadas</button>`:""}
      </div>`;
    }).join("");
  }

  const minhas=reservas.filter(r=>r.solicitante_id===S.user.id && ["pendente","aprovada"].includes(r.status) && new Date(r.fim).getTime()>=agora);
  html+=`<label style="margin-top:16px">🗓️ Minhas reservas</label>`;
  html+= minhas.length ? minhas.map(r=>reservaCard(r,{cancelar:true})).join("") : '<p class="sub">Você não tem reservas futuras.</p>';

  view().innerHTML=html; $("#fab").classList.add("hide");
  $("#rBack").addEventListener("click",()=>go("servicos"));
  $("#rAddArea")?.addEventListener("click",novaArea);
  view().querySelectorAll("[data-reservar]").forEach(b=>b.addEventListener("click",()=>solicitarReserva(b.dataset.reservar)));
  view().querySelectorAll("[data-bloq]").forEach(b=>b.addEventListener("click",()=>gerenciarBloqueios(b.dataset.bloq)));
  view().querySelectorAll("[data-aprovar]").forEach(b=>b.addEventListener("click",()=>decidirReserva(b.dataset.aprovar,true)));
  view().querySelectorAll("[data-rejeitar]").forEach(b=>b.addEventListener("click",()=>decidirReserva(b.dataset.rejeitar,false)));
  view().querySelectorAll("[data-cancelr]").forEach(b=>b.addEventListener("click",async()=>{
    if(!(await confirmar("Cancelar esta reserva?","Cancelar reserva"))) return;
    try{ await rpc("reserva_cancelar",{p_reserva:b.dataset.cancelr}); toast("Reserva cancelada"); renderReservas(); }catch(e){ toast(e.message); }
  }));
}
function novaArea(){
  let aprov=true;
  sheet(`<h2>Nova área comum</h2>
    <label>Nome</label><input id="aNome" class="field" placeholder="Salão de festas">
    <label>Descrição (opcional)</label><textarea id="aDesc" class="field" rows="2" placeholder="Regras, itens disponíveis..."></textarea>
    <label>Capacidade (opcional)</label><input id="aCap" class="field" type="number" min="1" placeholder="50">
    <label>Taxa de uso R$ (opcional)</label><input id="aTaxa" class="field" type="number" min="0" step="0.01" placeholder="150.00">
    <label>Reservas exigem aprovação?</label>
    <div class="seg" id="aAprov"><button data-a="1" class="on">Sim</button><button data-a="0">Não (confirma na hora)</button></div>
    <label style="margin-top:14px">Regras (opcional)</label>
    <div class="seg" style="gap:10px">
      <div style="flex:1"><label style="margin-top:0">Antec. mín (h)</label><input id="aMinH" class="field" type="number" min="0" placeholder="24"></div>
      <div style="flex:1"><label style="margin-top:0">Antec. máx (dias)</label><input id="aMaxD" class="field" type="number" min="1" placeholder="60"></div>
    </div>
    <div class="seg" style="gap:10px">
      <div style="flex:1"><label style="margin-top:0">Máx/mês por unidade</label><input id="aMaxMes" class="field" type="number" min="1" placeholder="2"></div>
    </div>
    <div class="seg" style="gap:10px">
      <div style="flex:1"><label style="margin-top:0">Abre às</label><input id="aAbre" class="field" type="time"></div>
      <div style="flex:1"><label style="margin-top:0">Fecha às</label><input id="aFecha" class="field" type="time"></div>
    </div>
    <button class="btn" id="aSave">Cadastrar área</button>`);
  $("#aAprov").querySelectorAll("[data-a]").forEach(b=>b.addEventListener("click",()=>{
    aprov=b.dataset.a==="1"; $("#aAprov").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
  }));
  $("#aSave").addEventListener("click",async()=>{
    const nome=$("#aNome").value.trim(); if(!nome) return toast("Informe o nome.");
    try{ await rpc("area_criar",{p_cond:S.condId,p_nome:nome,p_descricao:$("#aDesc").value.trim()||null,
      p_capacidade:$("#aCap").value?parseInt($("#aCap").value,10):null,p_requer_aprovacao:aprov,
      p_taxa:$("#aTaxa").value?parseFloat($("#aTaxa").value):null,
      p_ant_min_horas:$("#aMinH").value?parseInt($("#aMinH").value,10):null,
      p_ant_max_dias:$("#aMaxD").value?parseInt($("#aMaxD").value,10):null,
      p_max_mes:$("#aMaxMes").value?parseInt($("#aMaxMes").value,10):null,
      p_hora_abertura:$("#aAbre").value||null,p_hora_fechamento:$("#aFecha").value||null});
      closeSheet(); toast("Área cadastrada 🏛️"); renderReservas();
    }catch(e){ toast(e.message); }
  });
}
async function solicitarReserva(areaId){
  const a=(S._areas||[]).find(x=>x.id===areaId); if(!a) return;
  let unidade=S.unidadeId;
  if(!unidade){ const {data:un}=await sb.from("unidades").select("id").eq("condominio_id",S.condId).limit(1); unidade=un?.[0]?.id||null; }
  sheet(`<h2>Reservar ${esc(a.nome)}</h2>
    ${a.requer_aprovacao?'<p class="sub">Ficará pendente até o síndico aprovar.</p>':'<p class="sub">Confirmação automática.</p>'}
    <label>Data</label><input id="rvData" class="field" type="date">
    <div class="seg" style="gap:10px">
      <div style="flex:1"><label>Início</label><input id="rvIni" class="field" type="time" value="14:00"></div>
      <div style="flex:1"><label>Fim</label><input id="rvFim" class="field" type="time" value="18:00"></div></div>
    <label>Observação (opcional)</label><input id="rvObs" class="field" placeholder="Aniversário, ~30 pessoas">
    <button class="btn" id="rvSave">Solicitar reserva</button>`);
  $("#rvSave").addEventListener("click",async()=>{
    const d=$("#rvData").value, hi=$("#rvIni").value, hf=$("#rvFim").value;
    if(!d||!hi||!hf) return toast("Preencha data e horários.");
    const inicio=new Date(`${d}T${hi}`), fim=new Date(`${d}T${hf}`);
    if(fim<=inicio) return toast("O fim deve ser depois do início.");
    try{ const r=await rpc("reserva_solicitar",{p_cond:S.condId,p_area:areaId,p_inicio:inicio.toISOString(),p_fim:fim.toISOString(),p_unidade:unidade,p_obs:$("#rvObs").value.trim()||null});
      closeSheet();
      const baseMsg=r?.status==="aprovada"?"Reserva confirmada ✅":"Reserva solicitada ⏳";
      toast(r?.taxa?`${baseMsg} · taxa de ${fmtMoney(r.taxa)} lançada no Financeiro`:baseMsg);
      renderReservas();
    }catch(e){ toast(e.message); }
  });
}
function decidirReserva(id,aprovar){
  if(aprovar){
    (async()=>{ try{ await rpc("reserva_decidir",{p_reserva:id,p_aprovar:true}); toast("Reserva aprovada ✅"); renderReservas(); }catch(e){ toast(e.message); } })();
    return;
  }
  sheet(`<h2>Recusar reserva</h2><label>Motivo (opcional)</label>
    <textarea id="rjMot" class="field" rows="2" placeholder="Ex.: área em manutenção nesse dia"></textarea>
    <button class="btn" id="rjSave">Recusar reserva</button>`);
  $("#rjSave").addEventListener("click",async()=>{
    try{ await rpc("reserva_decidir",{p_reserva:id,p_aprovar:false,p_motivo:$("#rjMot").value.trim()||null});
      closeSheet(); toast("Reserva recusada"); renderReservas();
    }catch(e){ toast(e.message); }
  });
}
async function gerenciarBloqueios(areaId){
  const a=(S._areas||[]).find(x=>x.id===areaId);
  const {data:bloq}=await sb.from("area_bloqueios").select("*").eq("area_id",areaId).order("data");
  const list=(bloq||[]).map(b=>`<div class="tile" style="padding:10px 12px"><div class="row">
    <span style="flex:1">📅 ${new Date(b.data+"T00:00:00").toLocaleDateString("pt-BR")}${b.motivo?" — "+esc(b.motivo):""}</span>
    <button class="badge" data-delbloq="${b.id}">Remover</button></div></div>`).join("")||'<p class="sub">Nenhuma data bloqueada.</p>';
  sheet(`<h2>Datas bloqueadas${a?" — "+esc(a.nome):""}</h2>
    <label>Bloquear data</label><input id="bqData" class="field" type="date">
    <label>Motivo (opcional)</label><input id="bqMot" class="field" placeholder="Manutenção, feriado...">
    <button class="btn" id="bqAdd">Bloquear data</button>
    <label style="margin-top:16px">Bloqueios atuais</label>${list}`);
  $("#bqAdd").addEventListener("click",async()=>{
    const d=$("#bqData").value; if(!d) return toast("Escolha a data.");
    try{ await rpc("area_bloqueio_add",{p_area:areaId,p_data:d,p_motivo:$("#bqMot").value.trim()||null}); toast("Data bloqueada 🚫"); gerenciarBloqueios(areaId); }catch(e){ toast(e.message); }
  });
  $("#sheet").querySelectorAll("[data-delbloq]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("area_bloqueio_remover",{p_bloqueio:b.dataset.delbloq}); toast("Removido"); gerenciarBloqueios(areaId); }catch(e){ toast(e.message); }
  }));
}

// ===================================================================
// MÓDULO: FINANCEIRO (cobranças / taxa condominial)
// ===================================================================
// fmtMoney: em ./helpers.js
async function renderFinanceiro(){
  loading();
  const gestor=isGestor(S.role), sindico=isSindico(S.role);
  let cobrancas=[], unids=[];
  try{
    const [cb,un]=await Promise.all([
      sb.from("cobrancas").select("*, unidades(bloco,numero)").eq("condominio_id",S.condId).order("vencimento",{ascending:false}),
      sindico ? sb.from("unidades").select("id,bloco,numero").eq("condominio_id",S.condId).order("numero") : Promise.resolve({data:[]})
    ]);
    if(cb.error) throw cb.error; cobrancas=cb.data||[]; unids=un.data||[];
  }catch(e){ view().innerHTML=`<p class="empty">Erro: ${esc(e.message)}</p>`; return; }
  if(unids.length) S._unids=unids;

  const hoje=new Date(); hoje.setHours(0,0,0,0);
  const abertas=cobrancas.filter(c=>c.status==="aberta");
  const totalAberto=abertas.reduce((s,c)=>s+Number(c.valor),0);
  const vencidas=abertas.filter(c=>new Date(c.vencimento)<hoje);
  const totalPago=cobrancas.filter(c=>c.status==="paga").reduce((s,c)=>s+Number(c.valor),0);

  let html=`<div class="subhead"><button class="back" id="fBack">‹</button>
    <div class="h" style="margin:0">Financeiro <small>${gestor?"Cobranças do condomínio":"Suas cobranças"}</small></div></div>`;

  html+=`<div class="hub" style="grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
    <div class="hubcard" style="min-height:auto;padding:14px 12px;gap:2px"><small>${gestor?"Em aberto":"Você deve"}</small><b style="font-size:16px">${fmtMoney(totalAberto)}</b></div>
    <div class="hubcard" style="min-height:auto;padding:14px 12px;gap:2px"><small>Vencidas</small><b style="font-size:16px;color:${vencidas.length?"var(--danger)":"inherit"}">${vencidas.length}</b></div>
    <div class="hubcard" style="min-height:auto;padding:14px 12px;gap:2px"><small>${gestor?"Recebido":"Pago"}</small><b style="font-size:16px;color:var(--ok)">${fmtMoney(totalPago)}</b></div>
  </div>`;

  if(sindico) html+=`<button class="btn secondary" id="fLancar" style="margin-bottom:12px">➕ Lançar cobrança</button>`;
  if(sindico) html+=`<button class="btn secondary" id="fAuto" style="margin-bottom:12px">⚙️ Automação (recorrência & juros)</button>`;

  const fview = gestor ? (S._finView||"cobrancas") : "cobrancas";
  if(gestor){
    html+=`<div class="seg" id="fView" style="margin-bottom:12px">
      <button data-v="cobrancas" class="${fview==="cobrancas"?"on":""}">Cobranças</button>
      <button data-v="inadimplencia" class="${fview==="inadimplencia"?"on":""}">Inadimplência</button></div>`;
  }

  if(gestor && fview==="inadimplencia"){
    const byU={};
    abertas.forEach(c=>{ const k=c.unidade_id, un=c.unidades?unitLabel(c.unidades.bloco,c.unidades.numero):"—";
      const o=byU[k]||(byU[k]={uid:k,label:un,total:0,count:0,venc:0,cobs:[]});
      const enc=Number(c.multa||0)+Number(c.juros||0), tot=Number(c.valor)+enc;
      o.total+=tot; o.count++; o.cobs.push({id:c.id,descricao:c.descricao,total:tot,venc:c.vencimento});
      if(new Date(c.vencimento)<hoje) o.venc++; });
    const lista=Object.values(byU).sort((a,b)=>b.total-a.total);
    S._inadLista=lista; S._inadTotal=totalAberto; S._inadByU=byU;
    html+=`<div class="tile" style="background:#fdfce4;border-color:#ece79a"><b>⚠️ ${lista.length} unidade(s) com pendências · ${fmtMoney(totalAberto)}</b></div>`;
    if(lista.length) html+=`<button class="btn secondary" id="fInadPdf" style="margin:0 0 12px">📄 Relatório de inadimplência (PDF)</button>`;
    if(!lista.length) html+=`<p class="sub">Nenhuma pendência no momento. 🎉</p>`;
    else html+=lista.map(u=>`<div class="tile" style="padding:14px">
      <div class="row"><h3 style="flex:1;font-size:15px">🏠 ${esc(u.label)}</h3><b>${fmtMoney(u.total)}</b></div>
      <div class="meta"><span>${u.count} em aberto</span>${u.venc?`<span style="color:var(--danger)">${u.venc} vencida(s)</span>`:""}</div>
      ${sindico&&u.uid?`<button class="badge" data-acordo="${u.uid}" style="margin-top:10px">🤝 Fazer acordo (parcelar)</button>`:""}</div>`).join("");
  } else {
    let lista = (gestor && S._finUnidade) ? cobrancas.filter(c=>c.unidade_id===S._finUnidade) : cobrancas;
    if(gestor && (S._unids||[]).length){
      html+=`<label>Filtrar por unidade</label><select id="fUn" class="field" style="margin-bottom:12px">
        <option value="">Todas as unidades</option>${(S._unids||[]).map(u=>`<option value="${u.id}" ${S._finUnidade===u.id?"selected":""}>${esc(unitLabel(u.bloco,u.numero))}</option>`).join("")}</select>`;
    }
    if(!lista.length){
      html+=emptyBox("💰","Nenhuma cobrança.",sindico?"Lance a taxa condominial para começar.":"Quando o síndico lançar cobranças, aparecem aqui.");
    }else{
      html+=lista.map(c=>{
        const un=c.unidades?unitLabel(c.unidades.bloco,c.unidades.numero):"";
        const venc=new Date(c.vencimento), atrasada=c.status==="aberta"&&venc<hoje;
        const badge=c.status==="paga"?"resolvida":c.status==="cancelada"?"cancelada":atrasada?"urgente":"aberta";
        const label=c.status==="paga"?"Paga":c.status==="cancelada"?"Cancelada":atrasada?"Vencida":"Em aberto";
        const enc=Number(c.multa||0)+Number(c.juros||0), total=Number(c.valor)+enc;
        return `<div class="tile" style="padding:14px">
          <div class="row"><h3 style="flex:1;font-size:15px">${esc(c.descricao)}</h3><span class="badge ${badge}">${label}</span></div>
          <div class="row" style="margin-top:6px"><b style="font-size:17px">${fmtMoney(total)}</b>${enc>0&&c.status!=="cancelada"?`<span class="sub" style="margin:0 0 0 8px">${fmtMoney(c.valor)} + encargos ${fmtMoney(enc)}</span>`:""}</div>
          <div class="meta">${gestor&&un?`<span>🏠 ${esc(un)}</span>`:""}<span>📅 vence ${venc.toLocaleDateString("pt-BR")}</span>${c.status==="paga"&&c.pago_em?`<span>✅ pago ${new Date(c.pago_em).toLocaleDateString("pt-BR")}</span>`:""}</div>
          <div class="seg" style="margin-top:10px">
            <button class="badge" data-recibo="${c.id}">${c.status==="paga"?"🧾 Recibo":"📄 2ª via"}</button>
            ${(!gestor&&c.status==="aberta")?`<button class="btn" data-pagar="${c.id}" style="width:auto;margin:0;padding:9px 16px">💳 Pagar</button>`:""}
            ${(gestor&&c.status==="aberta")?`<button class="btn" data-paga="${c.id}" style="width:auto;margin:0;padding:9px 16px">✅ Marcar paga</button>`:""}
            ${(sindico&&c.status==="aberta")?`<button class="badge" data-cancfin="${c.id}">Cancelar</button>`:""}
          </div></div>`;
      }).join("");
    }
  }

  view().innerHTML=html; $("#fab").classList.add("hide");
  $("#fBack").addEventListener("click",()=>go("servicos"));
  $("#fLancar")?.addEventListener("click",lancarCobranca);
  $("#fAuto")?.addEventListener("click",configFinanceiro);
  view().querySelectorAll("#fView [data-v]").forEach(b=>b.addEventListener("click",()=>{ S._finView=b.dataset.v; renderFinanceiro(); }));
  $("#fInadPdf")?.addEventListener("click",()=>gerarRelInadimplencia(S._inadLista||[],S._inadTotal||0));
  view().querySelectorAll("[data-acordo]").forEach(b=>b.addEventListener("click",()=>acordoCriar((S._inadByU||{})[b.dataset.acordo])));
  $("#fUn")?.addEventListener("change",e=>{ S._finUnidade=e.target.value||null; renderFinanceiro(); });
  const cobMap={}; cobrancas.forEach(c=>cobMap[c.id]=c);
  view().querySelectorAll("[data-recibo]").forEach(b=>b.addEventListener("click",()=>mostrarRecibo(cobMap[b.dataset.recibo])));
  view().querySelectorAll("[data-pagar]").forEach(b=>b.addEventListener("click",()=>pagarCobranca(b.dataset.pagar)));
  view().querySelectorAll("[data-paga]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("cobranca_marcar_paga",{p_cobranca:b.dataset.paga}); toast("Baixa registrada ✅"); renderFinanceiro(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-cancfin]").forEach(b=>b.addEventListener("click",async()=>{
    if(!(await confirmar("Cancelar esta cobrança?","Cancelar cobrança"))) return;
    try{ await rpc("cobranca_cancelar",{p_cobranca:b.dataset.cancfin}); toast("Cobrança cancelada"); renderFinanceiro(); }catch(e){ toast(e.message); }
  }));
}
// Acordo de inadimplência: parcela as cobranças em aberto de uma unidade (síndico)
function acordoCriar(u){
  if(!u||!u.cobs||!u.cobs.length) return toast("Sem cobranças em aberto para esta unidade.");
  const hoje=new Date(); const prox=new Date(hoje.getFullYear(),hoje.getMonth()+1,10);
  const proxISO=`${prox.getFullYear()}-${String(prox.getMonth()+1).padStart(2,"0")}-10`;
  sheet(`<h2>🤝 Acordo de inadimplência</h2>
    <p class="sub" style="margin:0 2px 10px">🏠 ${esc(u.label)} — selecione as cobranças e parcele o total. As originais são canceladas e novas parcelas são geradas.</p>
    <div id="acCobs">${u.cobs.map(c=>`<label style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px"><input type="checkbox" class="acck" data-id="${c.id}" data-v="${c.total}" checked><span style="flex:1">${esc(c.descricao)} <span class="sub">· vence ${fmtDate(c.venc)}</span></span><b>${fmtMoney(c.total)}</b></label>`).join("")}</div>
    <div class="row" style="margin:10px 2px"><span style="flex:1">Total selecionado</span><b id="acTotal">${fmtMoney(u.total)}</b></div>
    <label>Entrada (opcional, R$)</label><input id="acEntrada" class="field" inputmode="decimal" placeholder="0,00">
    <div style="display:flex;gap:10px"><div style="flex:1"><label>Parcelas</label><input id="acParc" class="field" type="number" min="1" value="3"></div>
      <div style="flex:1"><label>1ª parcela vence</label><input id="acVenc" class="field" type="date" value="${proxISO}"></div></div>
    <label>Observação (opcional)</label><input id="acObs" class="field" placeholder="Ex.: acordo firmado em ${hoje.toLocaleDateString("pt-BR")}">
    <button class="btn" id="acSave" style="margin-top:14px">Gerar acordo</button>`);
  const recalc=()=>{ let t=0; document.querySelectorAll(".acck:checked").forEach(x=>t+=Number(x.dataset.v)); $("#acTotal").textContent=fmtMoney(t); };
  document.querySelectorAll(".acck").forEach(x=>x.addEventListener("change",recalc));
  $("#acSave").addEventListener("click",async()=>{
    const ids=[...document.querySelectorAll(".acck:checked")].map(x=>x.dataset.id); if(!ids.length) return toast("Selecione ao menos uma cobrança.");
    const parc=parseInt($("#acParc").value,10); if(!(parc>=1)) return toast("Número de parcelas inválido.");
    const venc=$("#acVenc").value; if(!venc) return toast("Informe o vencimento da 1ª parcela.");
    const entrada=Number(($("#acEntrada").value||"0").trim().replace(/\./g,"").replace(",","."))||0;
    let selTotal=0; document.querySelectorAll(".acck:checked").forEach(x=>selTotal+=Number(x.dataset.v));
    $("#acSave").disabled=true;
    try{ await rpc("acordo_criar",{p_cond:S.condId,p_unidade:u.uid,p_cobrancas:ids,p_parcelas:parc,p_primeiro_venc:venc,p_entrada:entrada,p_obs:$("#acObs").value.trim()||null});
      closeSheet(); toast("Acordo criado ✅ Parcelas geradas.");
      acordoPdf({label:u.label,total:selTotal,entrada,parcelas:parc,venc,obs:$("#acObs").value.trim()});
      renderFinanceiro(); }
    catch(e){ toast(e.message); $("#acSave").disabled=false; }
  });
}
// Documento do acordo (imprimir/PDF) — reconstrói o cronograma das parcelas
function acordoPdf(a){
  const w=window.open("","_blank"); if(!w){ toast("Permita pop-ups para gerar o PDF do acordo."); return; }
  const parcelar=Math.max(0,Math.round((a.total-(a.entrada||0))*100)/100);
  const base=Math.round(parcelar/a.parcelas*100)/100;
  const d0=new Date(a.venc+"T00:00:00"); const linhas=[];
  if(a.entrada>0) linhas.push(`<tr><td>Entrada</td><td>${d0.toLocaleDateString("pt-BR")}</td><td style="text-align:right">${fmtMoney(a.entrada)}</td></tr>`);
  for(let i=1;i<=a.parcelas;i++){ const val=i<a.parcelas?base:Math.round((parcelar-base*(a.parcelas-1))*100)/100;
    const dt=new Date(d0.getFullYear(),d0.getMonth()+(i-1),d0.getDate());
    linhas.push(`<tr><td>Parcela ${i}/${a.parcelas}</td><td>${dt.toLocaleDateString("pt-BR")}</td><td style="text-align:right">${fmtMoney(val)}</td></tr>`); }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Acordo — ${esc(a.label)}</title>
   <style>body{font-family:Arial,Helvetica,sans-serif;color:#12303a;padding:30px;max-width:760px;margin:0 auto}
   h1{font-size:20px;margin:0 0 2px}.sub{color:#5b7079;font-size:13px;margin:0 0 18px}
   table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ccc;padding:8px 10px;font-size:13px;text-align:left}th{background:#f2f6f7}
   .tot{margin-top:14px;font-size:15px}.sign{margin-top:56px;display:flex;gap:40px}.line{flex:1;border-top:1px solid #333;padding-top:6px;font-size:12px;text-align:center}</style></head><body>
   <h1>Acordo de Parcelamento de Débito</h1>
   <p class="sub">${esc(S.cond&&S.cond.nome||"Condomínio")} · Unidade ${esc(a.label)} · Emitido em ${new Date().toLocaleString("pt-BR")}</p>
   <p style="font-size:14px;line-height:1.5">Pelo presente instrumento, o condômino da unidade <b>${esc(a.label)}</b> reconhece o débito total de <b>${fmtMoney(a.total)}</b> e acorda o pagamento conforme o cronograma abaixo${a.entrada>0?` (entrada de ${fmtMoney(a.entrada)} + ${a.parcelas} parcela(s))`:` em ${a.parcelas} parcela(s)`}.</p>
   <table><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>${linhas.join("")}</tbody></table>
   <p class="tot">Total do acordo: <b>${fmtMoney(a.total)}</b></p>
   ${a.obs?`<p class="sub" style="margin-top:10px">Observações: ${esc(a.obs)}</p>`:""}
   <div class="sign"><div class="line">Condômino (unidade ${esc(a.label)})</div><div class="line">Síndico / Administração</div></div>
   <p class="sub" style="margin-top:24px">As parcelas foram lançadas no Financeiro como cobranças e podem ser pagas pelo app.</p>
   </body></html>`);
  w.document.close(); w.focus(); setTimeout(()=>{ try{ w.print(); }catch(_){} },300);
}
// Automação financeira: cobranças recorrentes + juros/multa (síndico)
async function configFinanceiro(){
  sheet('<h2>Automação financeira</h2><div class="spin"></div>');
  let recs=[], cfg={encargos_ativo:false,multa_pct:2,juros_mes_pct:1};
  try{
    const [rc,cc]=await Promise.all([
      sb.from("recorrencias").select("*").eq("condominio_id",S.condId).order("created_at"),
      sb.from("condominios").select("encargos_ativo,multa_pct,juros_mes_pct").eq("id",S.condId).single()
    ]);
    recs=rc.data||[]; if(cc.data) cfg=cc.data;
  }catch(_){}
  const recList=recs.length?recs.map(r=>`<div class="tile" style="padding:12px 14px">
      <div class="row"><h3 style="flex:1;font-size:15px">${esc(r.descricao)}</h3><b>${fmtMoney(r.valor)}</b></div>
      <div class="meta"><span>🗓️ vence dia ${r.dia_vencimento}</span><span class="badge ${r.ativo?"resolvida":"cancelada"}">${r.ativo?"Ativa":"Pausada"}</span></div>
      <div class="meta"><button class="badge" data-recedit="${r.id}" style="cursor:pointer">✏️ Editar</button><button class="badge cancelada" data-recdel="${r.id}" style="cursor:pointer">🗑️ Remover</button></div>
    </div>`).join(""):'<p class="sub">Nenhuma cobrança recorrente ainda.</p>';
  sheet(`<h2>Automação financeira</h2>
    <div class="h" style="font-size:15px;margin:6px 2px 6px">🔁 Cobranças recorrentes</div>
    <p class="sub" style="margin:0 2px 10px">Todo mês o sistema lança estas cobranças para todas as unidades — sem trabalho manual.</p>
    <div id="recList">${recList}</div>
    <button class="btn secondary" id="recAdd" style="margin:8px 0 4px">＋ Nova recorrência</button>
    ${recs.some(r=>r.ativo)?`<button class="btn" id="recGerar" style="margin:8px 0 4px">⚡ Gerar cobranças deste mês agora</button>`:""}
    <div class="h" style="font-size:15px;margin:18px 2px 6px">⏰ Juros & multa por atraso</div>
    <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="encAtivo" ${cfg.encargos_ativo?"checked":""}> Aplicar em cobranças vencidas</label>
    <div style="display:flex;gap:10px;margin-top:10px">
      <div style="flex:1"><label>Multa (%)</label><input id="encMulta" class="field" type="number" step="0.1" value="${cfg.multa_pct}"></div>
      <div style="flex:1"><label>Juros (% ao mês)</label><input id="encJuros" class="field" type="number" step="0.1" value="${cfg.juros_mes_pct}"></div>
    </div>
    <button class="btn" id="encSave" style="margin-top:14px">Salvar encargos</button>`);
  $("#recAdd").addEventListener("click",()=>formRecorrencia());
  $("#recGerar")?.addEventListener("click",async()=>{
    if(!await confirmar("Gerar as cobranças recorrentes deste mês para todas as unidades agora? Cobranças já lançadas neste mês não são duplicadas.","Gerar agora")) return;
    try{ const n=await rpc("recorrencias_gerar_agora",{p_cond:S.condId});
      toast(n>0?`${n} cobrança(s) gerada(s) 🧾`:"Tudo já estava lançado neste mês."); closeSheet(); renderFinanceiro();
    }catch(e){ toast(e.message); }
  });
  $("#recList").querySelectorAll("[data-recedit]").forEach(b=>b.addEventListener("click",()=>formRecorrencia(recs.find(r=>r.id===b.dataset.recedit))));
  $("#recList").querySelectorAll("[data-recdel]").forEach(b=>b.addEventListener("click",async()=>{
    if(!await confirmar("Remover esta recorrência? As cobranças já geradas não são afetadas.","Remover")) return;
    try{ await rpc("recorrencia_excluir",{p_id:b.dataset.recdel}); toast("Removida"); configFinanceiro(); }catch(e){ toast(e.message); }
  }));
  $("#encSave").addEventListener("click",async()=>{
    try{ await rpc("encargos_config_salvar",{p_cond:S.condId,p_ativo:$("#encAtivo").checked,p_multa_pct:Number($("#encMulta").value||0),p_juros_pct:Number($("#encJuros").value||0)});
      toast("Encargos salvos ⚙️"); closeSheet();
    }catch(e){ toast(e.message); }
  });
}
function formRecorrencia(r){
  sheet(`<h2>${r?"Editar recorrência":"Nova recorrência"}</h2>
    <label>Descrição</label><input id="rcDesc" class="field" placeholder="Taxa condominial" value="${r?esc(r.descricao):""}">
    <div style="display:flex;gap:10px">
      <div style="flex:1"><label>Valor (R$)</label><input id="rcValor" class="field" type="number" step="0.01" value="${r?r.valor:""}" placeholder="350.00"></div>
      <div style="flex:1"><label>Vence dia</label><input id="rcDia" class="field" type="number" min="1" max="28" value="${r?r.dia_vencimento:10}"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="rcAtivo" ${(!r||r.ativo)?"checked":""}> Ativa</label>
    <button class="btn" id="rcSave" style="margin-top:14px">${r?"Salvar":"Criar recorrência"}</button>`);
  $("#rcSave").addEventListener("click",async()=>{
    const desc=$("#rcDesc").value.trim(); if(!desc) return toast("Informe a descrição.");
    const valor=Number($("#rcValor").value); if(!(valor>=0)) return toast("Valor inválido.");
    const dia=Number($("#rcDia").value); if(!(dia>=1&&dia<=28)) return toast("Dia de vencimento entre 1 e 28.");
    try{ await rpc("recorrencia_salvar",{p_cond:S.condId,p_descricao:desc,p_valor:valor,p_dia_venc:dia,p_ativo:$("#rcAtivo").checked,p_id:r?r.id:null});
      toast("Recorrência salva 🔁"); configFinanceiro();
    }catch(e){ toast(e.message); }
  });
}
// Pagamento online (Mercado Pago) — chama a Edge Function `pagar-cobranca`.
// Suporta Checkout Pro (init_point) e, opcionalmente, PIX in-app (pix.qr_code).
async function pagarCobranca(id){
  sheet('<h2>Pagamento</h2><div class="spin"></div>');
  try{
    const { data, error } = await sb.functions.invoke("pagar-cobranca", { body:{ cobranca_id:id } });
    if(error) throw error;
    if(data && data.error) throw new Error(data.error);
    if(data && data.init_point){
      sheet(`<h2>Pagar cobrança</h2>
        <p class="sub">Você será levado ao ambiente seguro do Mercado Pago para pagar com PIX, boleto ou cartão.</p>
        <a class="btn" href="${esc(data.init_point)}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;color:#fff">Ir para o pagamento →</a>
        <p class="sub" style="margin-top:12px">Assim que o pagamento for confirmado, a baixa é automática (pode levar alguns minutos).</p>`);
      return;
    }
    if(data && data.pix && data.pix.qr_code){
      sheet(`<h2>Pagar com PIX</h2>
        <p class="sub">Escaneie o QR ou copie o código no app do seu banco.</p>
        <div style="text-align:center">${qrImg(data.pix.qr_code,6)}</div>
        <div class="codebox" style="font-size:12px;word-break:break-all;letter-spacing:0">${esc(data.pix.qr_code)}</div>
        <button class="btn" id="pixCopy">📋 Copiar código PIX</button>`);
      $("#pixCopy").addEventListener("click",()=>{ try{ navigator.clipboard.writeText(data.pix.qr_code); toast("Código copiado ✅"); }catch(_){ toast("Copie o código manualmente."); } });
      return;
    }
    throw new Error("Resposta inesperada do pagamento.");
  }catch(e){
    sheet(`<h2>Pagamento</h2>
      <p class="sub">${esc(e.message||"Falha ao iniciar o pagamento.")}</p>
      <p class="sub" style="margin-top:8px">O pagamento online ainda não está ativo neste condomínio. É preciso conectar o Mercado Pago (ver instruções do síndico).</p>
      <button class="btn secondary" id="pgClose">Fechar</button>`);
    $("#pgClose")?.addEventListener("click",closeSheet);
  }
}
function mostrarRecibo(c){
  if(!c) return;
  const un=c.unidades?unitLabel(c.unidades.bloco,c.unidades.numero):"—";
  const pago=c.status==="paga";
  const wrap=document.createElement("div"); wrap.id="reciboWrap";
  wrap.innerHTML=`<div class="recibo">
    <div class="rc-head"><b>🏢 ${esc(S.cond.nome||"Condomínio")}</b><span>${esc(S.cond.cidade?S.cond.cidade+(S.cond.uf?"/"+S.cond.uf:""):"")}</span></div>
    <h2>${pago?"Recibo de pagamento":"Demonstrativo / 2ª via"}</h2>
    <table class="rc-tab">
      <tr><td>Unidade</td><td>${esc(un)}</td></tr>
      <tr><td>Descrição</td><td>${esc(c.descricao)}</td></tr>
      ${c.competencia?`<tr><td>Competência</td><td>${esc(c.competencia)}</td></tr>`:""}
      <tr><td>Vencimento</td><td>${new Date(c.vencimento).toLocaleDateString("pt-BR")}</td></tr>
      <tr><td>Situação</td><td>${pago?"PAGO":c.status==="cancelada"?"CANCELADO":"EM ABERTO"}</td></tr>
      ${pago&&c.pago_em?`<tr><td>Pago em</td><td>${new Date(c.pago_em).toLocaleDateString("pt-BR")}</td></tr>`:""}
    </table>
    <div class="rc-total">Valor: <b>${fmtMoney(c.valor)}</b></div>
    <p class="rc-note">Documento interno de controle do condomínio${pago?", comprovando o pagamento acima.":". Não é um boleto bancário — para 2ª via com código de barras, consulte a administradora."}<br>Emitido em ${new Date().toLocaleString("pt-BR")}.</p>
    <div class="no-print" style="display:flex;gap:10px;margin-top:18px">
      <button class="btn secondary" id="rcClose">Fechar</button>
      <button class="btn" id="rcPrint">🖨️ Imprimir / Salvar PDF</button>
    </div></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#rcClose").onclick=()=>wrap.remove();
  wrap.querySelector("#rcPrint").onclick=()=>window.print();
}
async function gerarAta(id){
  let d;
  try{ d=await rpc("assembleia_ata",{p_assembleia:id}); }catch(e){ return toast(e.message); }
  const pond=!!d.ponderado;
  const total=d.total_unidades||0, part=d.unidades_participantes||0;
  const pct=pond
    ? ((Number(d.fracao_total)||0)?Math.round((Number(d.fracao_participante)||0)/(Number(d.fracao_total))*100):0)
    : (total?Math.round(part/total*100):0);
  const qmin=d.quorum_minimo!=null?Math.round(d.quorum_minimo*100):null;
  const atingido=qmin==null||pct>=qmin;
  const resultado=p=>{ const s=pond?(Number(p.peso_sim)||0):(p.sim||0), n=pond?(Number(p.peso_nao)||0):(p.nao||0); if(s>n) return "APROVADA"; if(n>s) return "REPROVADA"; return "EMPATE"; };
  const wrap=document.createElement("div"); wrap.id="reciboWrap";
  wrap.innerHTML=`<div class="recibo">
    <div class="rc-head"><b>🏢 ${esc(d.condominio||S.cond.nome||"Condomínio")}</b><span>${esc(S.cond.cidade?S.cond.cidade+(S.cond.uf?"/"+S.cond.uf:""):"")}</span></div>
    <h2>Ata — ${esc(d.titulo)}</h2>
    ${d.descricao?`<p style="margin:0 0 12px;line-height:1.5">${esc(d.descricao).replace(/\n/g,"<br>")}</p>`:""}
    <table class="rc-tab">
      <tr><td>Status</td><td>${ASSEM_STATUS[d.status]||d.status}</td></tr>
      ${d.data_evento?`<tr><td>Data</td><td>${new Date(d.data_evento).toLocaleString("pt-BR")}</td></tr>`:""}
      <tr><td>Unidades participantes</td><td>${part} de ${total} (${pct}%${pond?" por fração ideal":""})</td></tr>
      <tr><td>Apuração</td><td>${pond?"ponderada por fração ideal":"por unidade (1 voto)"}</td></tr>
      <tr><td>Quórum</td><td>${qmin==null?"não exigido":`mínimo ${qmin}% — ${atingido?"ATINGIDO":"NÃO ATINGIDO"}`}</td></tr>
    </table>
    <h3 style="font-size:15px;margin:16px 0 8px">Deliberações</h3>
    ${(d.pautas||[]).length? d.pautas.map((p,i)=>`
      <div style="border-bottom:1px solid var(--line);padding:8px 0">
        <b>${i+1}. ${esc(p.titulo)}</b>
        <div style="font-size:13px;color:var(--muted);margin-top:3px">Sim: ${p.sim||0} · Não: ${p.nao||0} · Abstenção: ${p.abstencao||0} · Total: ${p.total||0}${pond?` — fração → Sim ${(+p.peso_sim).toLocaleString("pt-BR")} · Não ${(+p.peso_nao).toLocaleString("pt-BR")}`:""}</div>
        <div style="font-size:13px;margin-top:3px">Resultado: <b>${resultado(p)}</b>${atingido?"":" — sem quórum"}</div>
      </div>`).join(""):'<p class="sub">Nenhuma pauta.</p>'}
    <p class="rc-note">Ata gerada automaticamente pelo VIZELLO em ${new Date().toLocaleString("pt-BR")}. Documento interno do condomínio.</p>
    <div class="no-print" style="display:flex;gap:10px;margin-top:18px">
      <button class="btn secondary" id="ataClose">Fechar</button>
      <button class="btn" id="ataPrint">🖨️ Imprimir / Salvar PDF</button>
    </div></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#ataClose").onclick=()=>wrap.remove();
  wrap.querySelector("#ataPrint").onclick=()=>window.print();
}
function gerarBalancete(pc,ano,saldo){
  const meses=pc.meses||[];
  const desp=pc.despesas_lista||[];
  const wrap=document.createElement("div"); wrap.id="reciboWrap";
  wrap.innerHTML=`<div class="recibo">
    <div class="rc-head"><b>🏢 ${esc(S.cond.nome||"Condomínio")}</b><span>${esc(S.cond.cidade?S.cond.cidade+(S.cond.uf?"/"+S.cond.uf:""):"")}</span></div>
    <h2>Balancete — ${ano}</h2>
    <table class="rc-tab">
      <tr><td>Total de receitas</td><td>${fmtMoney(pc.total_receitas)}</td></tr>
      <tr><td>Total de despesas</td><td>${fmtMoney(pc.total_despesas)}</td></tr>
      <tr><td><b>Saldo do período</b></td><td><b>${fmtMoney(saldo)}</b></td></tr>
    </table>
    <h3 style="font-size:15px;margin:16px 0 8px">Movimento por mês</h3>
    <table class="rc-tab">
      <tr><td style="width:34%">Mês</td><td>Receitas</td><td>Despesas</td></tr>
      ${meses.map((m,i)=>`<tr><td>${MESES_ABREV[i]}</td><td>${fmtMoney(m.receitas)}</td><td>${fmtMoney(m.despesas)}</td></tr>`).join("")}
    </table>
    <h3 style="font-size:15px;margin:16px 0 8px">Despesas do período</h3>
    ${desp.length?`<table class="rc-tab"><tr><td style="width:20%">Data</td><td>Descrição</td><td style="text-align:right">Valor</td></tr>
      ${desp.map(d=>`<tr><td>${d.data?new Date(d.data).toLocaleDateString("pt-BR"):"—"}</td><td>${esc(d.descricao)} <span style="color:#888">(${DESP_CAT[d.categoria]||d.categoria})</span></td><td style="text-align:right">${fmtMoney(d.valor)}</td></tr>`).join("")}
      </table>`:'<p class="sub">Nenhuma despesa lançada.</p>'}
    <p class="rc-note">Balancete gerado automaticamente pelo VIZELLO em ${new Date().toLocaleString("pt-BR")}. Documento interno de controle — receitas consideram cobranças pagas.</p>
    <div class="no-print" style="display:flex;gap:10px;margin-top:18px">
      <button class="btn secondary" id="balClose">Fechar</button>
      <button class="btn" id="balPrint">🖨️ Imprimir / Salvar PDF</button>
    </div></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#balClose").onclick=()=>wrap.remove();
  wrap.querySelector("#balPrint").onclick=()=>window.print();
}
function gerarRelInadimplencia(lista,total){
  const wrap=document.createElement("div"); wrap.id="reciboWrap";
  wrap.innerHTML=`<div class="recibo">
    <div class="rc-head"><b>🏢 ${esc(S.cond.nome||"Condomínio")}</b><span>${esc(S.cond.cidade?S.cond.cidade+(S.cond.uf?"/"+S.cond.uf:""):"")}</span></div>
    <h2>Relatório de inadimplência</h2>
    <table class="rc-tab">
      <tr><td>Unidades com pendência</td><td>${lista.length}</td></tr>
      <tr><td><b>Total em aberto</b></td><td><b>${fmtMoney(total)}</b></td></tr>
    </table>
    <h3 style="font-size:15px;margin:16px 0 8px">Por unidade</h3>
    ${lista.length?`<table class="rc-tab"><tr><td>Unidade</td><td>Cobranças</td><td>Vencidas</td><td style="text-align:right">Total</td></tr>
      ${lista.map(u=>`<tr><td>${esc(u.label)}</td><td>${u.count}</td><td>${u.venc||0}</td><td style="text-align:right">${fmtMoney(u.total)}</td></tr>`).join("")}
      </table>`:'<p class="sub">Sem pendências.</p>'}
    <p class="rc-note">Relatório gerado pelo VIZELLO em ${new Date().toLocaleString("pt-BR")}. Considera cobranças em aberto (inclui não vencidas).</p>
    <div class="no-print" style="display:flex;gap:10px;margin-top:18px">
      <button class="btn secondary" id="inClose">Fechar</button>
      <button class="btn" id="inPrint">🖨️ Imprimir / Salvar PDF</button>
    </div></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#inClose").onclick=()=>wrap.remove();
  wrap.querySelector("#inPrint").onclick=()=>window.print();
}
function lancarCobranca(){
  let alvo="todos";
  const mesAtual=new Date().toISOString().slice(0,7);
  const venc=new Date(Date.now()+10*864e5).toISOString().slice(0,10);
  sheet(`<h2>Lançar cobrança</h2>
    <label>Para</label>
    <div class="seg" id="cbAlvo"><button data-t="todos" class="on">Todas as unidades</button><button data-t="uma">Uma unidade</button></div>
    <div id="cbUnidWrap" class="hide"><label>Unidade</label><select id="cbUnid" class="field">${unitOptions()}</select></div>
    <label>Descrição</label><input id="cbDesc" class="field" placeholder="Taxa condominial ${mesAtual}">
    <label>Valor (R$)</label><input id="cbValor" class="field" type="number" min="0" step="0.01" placeholder="450.00">
    <label>Vencimento</label><input id="cbVenc" class="field" type="date" value="${venc}">
    <label>Competência (opcional)</label><input id="cbComp" class="field" type="month" value="${mesAtual}">
    <button class="btn" id="cbSave">Lançar</button>`);
  $("#cbAlvo").querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{
    alvo=b.dataset.t; $("#cbAlvo").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
    $("#cbUnidWrap").classList.toggle("hide",alvo!=="uma");
  }));
  $("#cbSave").addEventListener("click",async()=>{
    const desc=$("#cbDesc").value.trim()||`Taxa condominial ${mesAtual}`;
    const valor=parseFloat($("#cbValor").value), vencv=$("#cbVenc").value, comp=$("#cbComp").value||null;
    if(!valor||valor<=0) return toast("Informe o valor.");
    if(!vencv) return toast("Informe o vencimento.");
    try{
      if(alvo==="todos"){
        const n=await rpc("cobranca_lancar_todos",{p_cond:S.condId,p_descricao:desc,p_valor:valor,p_vencimento:vencv,p_competencia:comp});
        closeSheet(); toast(n?`${n} cobrança(s) lançada(s) 💰`:"Nenhuma nova (já existiam)"); renderFinanceiro();
      }else{
        const un=$("#cbUnid").value; if(!un) return toast("Escolha a unidade.");
        await rpc("cobranca_lancar",{p_cond:S.condId,p_unidade:un,p_descricao:desc,p_valor:valor,p_vencimento:vencv,p_competencia:comp});
        closeSheet(); toast("Cobrança lançada 💰"); renderFinanceiro();
      }
    }catch(e){ toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: ASSEMBLEIAS E VOTAÇÕES
// ===================================================================
const ASSEM_STATUS = {agendada:"Agendada",aberta:"Votação aberta",encerrada:"Encerrada",cancelada:"Cancelada"};
const assemBadge = s => ({agendada:"aberta",aberta:"em_andamento",encerrada:"resolvida",cancelada:"cancelada"}[s]||"");
const ESCOLHA_LABEL = {sim:"Sim",nao:"Não",abstencao:"Abstenção"};
async function renderAssembleias(){
  loading();
  let assembleias=[];
  try{
    const {data,error}=await sb.from("assembleias").select("*").eq("condominio_id",S.condId).order("created_at",{ascending:false});
    if(error) throw error; assembleias=data||[];
  }catch(e){ view().innerHTML=`<p class="empty">Erro: ${esc(e.message)}</p>`; return; }
  let html=`<div class="subhead"><button class="back" id="asBack">‹</button>
    <div class="h" style="margin:0">Assembleias <small>Pautas e votações do condomínio</small></div></div>`;
  if(isSindico(S.role)) html+=`<button class="btn secondary" id="asNova" style="margin-bottom:14px">➕ Nova assembleia</button>`;
  if(!assembleias.length){
    html+=emptyBox("🗳️","Nenhuma assembleia.",isSindico(S.role)?"Crie uma assembleia e adicione as pautas.":"Você será avisado quando houver assembleia.");
  }else{
    html+=assembleias.map(a=>`<div class="tile" data-assem="${a.id}" style="cursor:pointer">
      <div class="row"><h3 style="flex:1">${esc(a.titulo)}</h3><span class="badge ${assemBadge(a.status)}">${ASSEM_STATUS[a.status]}</span></div>
      ${a.descricao?`<p>${esc(a.descricao).slice(0,120)}</p>`:""}
      ${a.data_evento?`<div class="meta"><span>📅 ${fmtDate(a.data_evento)}</span></div>`:""}</div>`).join("");
  }
  view().innerHTML=html; $("#fab").classList.add("hide");
  $("#asBack").addEventListener("click",()=>go("servicos"));
  $("#asNova")?.addEventListener("click",novaAssembleia);
  view().querySelectorAll("[data-assem]").forEach(b=>b.addEventListener("click",()=>abrirAssembleia(b.dataset.assem)));
}
function novaAssembleia(){
  sheet(`<h2>Nova assembleia</h2>
    <label>Título</label><input id="asTit" class="field" placeholder="Assembleia Geral Ordinária 2026">
    <label>Descrição (opcional)</label><textarea id="asDesc" class="field" rows="2" placeholder="Local, horário, pauta geral..."></textarea>
    <label>Data/hora (opcional)</label><input id="asData" class="field" type="datetime-local">
    <label>Quórum mínimo (opcional, % das unidades)</label><input id="asQuorum" class="field" inputmode="numeric" placeholder="Ex.: 50">
    <button class="btn" id="asSave">Criar assembleia</button>`);
  $("#asSave").addEventListener("click",async()=>{
    const t=$("#asTit").value.trim(); if(!t) return toast("Informe o título.");
    const dv=$("#asData").value?new Date($("#asData").value).toISOString():null;
    const qraw=$("#asQuorum").value.trim(); const quorum=qraw?Math.min(100,Math.max(0,Number(qraw)))/100:null;
    if(qraw && isNaN(Number(qraw))) return toast("Quórum inválido.");
    try{ await rpc("assembleia_criar",{p_cond:S.condId,p_titulo:t,p_descricao:$("#asDesc").value.trim()||null,p_data:dv,p_quorum:quorum});
      closeSheet(); toast("Assembleia criada 🗳️"); renderAssembleias();
    }catch(e){ toast(e.message); }
  });
}
async function abrirAssembleia(id){
  let a=null, pautas=[];
  try{
    const [ar,pr]=await Promise.all([
      sb.from("assembleias").select("*").eq("id",id).single(),
      sb.from("pautas").select("*").eq("assembleia_id",id).order("ordem")
    ]);
    a=ar.data; pautas=pr.data||[];
  }catch(e){ return toast(e.message); }
  if(!a) return toast("Assembleia não encontrada.");
  const results={};
  await Promise.all(pautas.map(async p=>{ try{ results[p.id]=await rpc("pauta_resultado",{p_pauta:p.id}); }catch(_){ results[p.id]=null; } }));

  // quórum ao vivo + procurações
  let q=null; try{ q=await rpc("assembleia_quorum",{p_assembleia:id}); }catch(_){}
  let procs=[]; try{ const {data}=await sb.from("procuracoes").select("*, unidades(bloco,numero)").eq("assembleia_id",id).eq("status","ativa"); procs=data||[]; }catch(_){}
  const minhaOutorga=procs.find(p=>p.outorgante_user===S.user.id);
  const represento=procs.filter(p=>p.procurador_user===S.user.id);
  const votosProxy={};
  if(represento.length){
    try{ const {data:vp}=await sb.from("votos").select("pauta_id,unidade_id,escolha").in("unidade_id",represento.map(p=>p.outorgante_unidade));
      (vp||[]).forEach(v=>votosProxy[`${v.pauta_id}:${v.unidade_id}`]=v.escolha); }catch(_){}
  }

  const sindico=isSindico(S.role), aberta=a.status==="aberta";
  let ctrl="";
  if(sindico){
    if(a.status==="agendada") ctrl=`<button class="btn" data-asst="aberta" style="margin-top:6px">▶️ Abrir votação</button>`;
    else if(a.status==="aberta") ctrl=`<button class="btn" data-asst="encerrada" style="margin-top:6px">⏹️ Encerrar votação</button>`;
  }
  const pautasHtml = pautas.length ? pautas.map(p=>{
    const r=results[p.id]||{sim:0,nao:0,abstencao:0,total:0,meu_voto:null};
    const total=r.total||0;
    const pond=!!r.ponderado;
    // quando o condomínio usa fração ideal, as barras mostram o peso (fração) de cada opção
    const wTot=pond?(Number(r.peso_total)||0):total;
    const wVal={sim:pond?Number(r.peso_sim)||0:r.sim, nao:pond?Number(r.peso_nao)||0:r.nao, abstencao:pond?Number(r.peso_abstencao)||0:r.abstencao};
    const bar=(key,cor,lbl,cnt)=>{ const n=wVal[key]; const pct=wTot?Math.round(n/wTot*100):0; return `<div style="margin:4px 0">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)"><span>${lbl}</span><span>${cnt} ${pond?"voto(s) · ":""}(${pct}%)</span></div>
      <div style="height:8px;background:var(--chip);border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${cor}"></div></div></div>`; };
    const podeVotar=aberta && p.status==="aberta";
    const voteBtns=podeVotar?`<div class="seg" style="margin-top:8px">
      ${[["sim","👍 Sim"],["nao","👎 Não"],["abstencao","➖ Abstenção"]].map(([k,l])=>`<button data-voto="${p.id}:${k}" class="${r.meu_voto===k?"on":""}">${l}</button>`).join("")}</div>`:"";
    const proxyRows=(podeVotar&&represento.length)?represento.map(pr=>{
      const ulbl=pr.unidades?unitLabel(pr.unidades.bloco,pr.unidades.numero):"unidade";
      const cur=votosProxy[`${p.id}:${pr.outorgante_unidade}`];
      return `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
        <div class="sub" style="margin:0 0 4px">📜 Voto por ${esc(ulbl)} (procuração)</div>
        <div class="seg">${[["sim","👍 Sim"],["nao","👎 Não"],["abstencao","➖ Absten."]].map(([k,l])=>`<button data-votop="${p.id}:${pr.outorgante_unidade}:${k}" class="${cur===k?"on":""}">${l}</button>`).join("")}</div></div>`;
    }).join(""):"";
    return `<div class="tile" style="padding:14px;margin-top:10px">
      <div class="row"><h3 style="flex:1;font-size:15px">${esc(p.titulo)}</h3>
        ${p.status==="encerrada"?'<span class="badge cancelada">Encerrada</span>':aberta?'<span class="badge em_andamento">Aberta</span>':""}</div>
      ${p.descricao?`<p>${esc(p.descricao)}</p>`:""}
      ${voteBtns}${proxyRows}
      ${r.meu_voto?`<p class="sub" style="margin-top:6px">Seu voto: <b>${ESCOLHA_LABEL[r.meu_voto]}</b></p>`:""}
      <div style="margin-top:8px">${bar("sim","var(--ok)","Sim",r.sim)}${bar("nao","var(--danger)","Não",r.nao)}${bar("abstencao","#98a7b0","Abstenção",r.abstencao)}
        <div class="sub" style="margin-top:4px">${total} voto(s) · ${pond?"ponderado por fração ideal":"1 por unidade"}</div></div>
      ${sindico&&p.status==="aberta"?`<button class="badge" data-encpauta="${p.id}" style="margin-top:8px">Encerrar pauta</button>`:""}
    </div>`;
  }).join("") : '<p class="sub">Nenhuma pauta ainda.</p>';

  const qHtml = q ? (function(){
    const tot=q.total_unidades||0, pres=q.presentes||0, pct=tot?Math.round(pres/tot*100):0;
    const qm=q.quorum_minimo!=null?Math.round(q.quorum_minimo*100):null;
    const cor=q.atingido===true?"var(--ok)":q.atingido===false?"var(--warn)":"var(--brand)";
    return `<div class="tile" style="margin:10px 0 4px;padding:12px 14px">
      <div class="row" style="justify-content:space-between"><b style="font-size:14px">📊 Quórum ao vivo</b>
        <span class="badge ${q.atingido===true?"resolvida":q.atingido===false?"urgente":""}">${pres}/${tot} un.${qm!=null?" · mín. "+qm+"%":""}</span></div>
      <div style="height:10px;background:var(--chip);border-radius:6px;overflow:hidden;margin-top:8px;position:relative">
        <div style="height:100%;width:${pct}%;background:${cor}"></div>
        ${qm!=null?`<div style="position:absolute;top:0;bottom:0;left:${qm}%;width:2px;background:var(--ink);opacity:.6"></div>`:""}</div>
      <div class="sub" style="margin-top:6px">${pct}% participando${qm!=null?(q.atingido?" · ✅ quórum atingido":" · faltam "+Math.max(0,(q.necessarias||0)-pres)+" unidade(s)"):""}${q.procuracoes?` · 📜 ${q.procuracoes} procuração(ões)`:""}</div>
    </div>`;
  })() : "";
  const procHtml = (a.status!=="encerrada" && S.unidadeId)
    ? (minhaOutorga
        ? `<button class="btn ghost" id="procRevogar" style="margin-top:8px">📜 Revogar minha procuração</button>`
        : `<button class="btn secondary" id="procDar" style="margin-top:8px">📜 Dar procuração (delegar meu voto)</button>`)
    : "";
  const represHtml = represento.length ? `<p class="sub" style="margin-top:8px">📜 Você vota por procuração de: ${represento.map(p=>esc(p.unidades?unitLabel(p.unidades.bloco,p.unidades.numero):"—")).join(", ")}</p>` : "";

  sheet(`<h2>${esc(a.titulo)}</h2>
    <div class="meta"><span class="badge ${assemBadge(a.status)}">${ASSEM_STATUS[a.status]}</span>${a.data_evento?`<span>📅 ${fmtDate(a.data_evento)}</span>`:""}${a.quorum_minimo!=null?`<span>🎯 quórum mín. ${Math.round(a.quorum_minimo*100)}%</span>`:""}</div>
    ${a.descricao?`<p style="margin:10px 0;line-height:1.5">${esc(a.descricao).replace(/\n/g,"<br>")}</p>`:""}
    ${qHtml}
    ${ctrl}
    ${sindico?`<button class="btn secondary" id="asAddPauta" style="margin-top:8px">➕ Nova pauta</button>`:""}
    <button class="btn secondary" id="asAta" style="margin-top:8px">📄 Gerar ata (PDF)</button>
    ${procHtml}${represHtml}
    <label style="margin-top:14px">Pautas</label>${pautasHtml}`);

  const sh=$("#sheet");
  $("#asAta")?.addEventListener("click",()=>gerarAta(id));
  $("#procDar")?.addEventListener("click",()=>darProcuracao(id));
  $("#procRevogar")?.addEventListener("click",async()=>{
    if(!await confirmar("Revogar a procuração? Seu voto volta a ser exercido só por você.","Revogar")) return;
    try{ await rpc("procuracao_revogar",{p_id:minhaOutorga.id}); toast("Procuração revogada"); abrirAssembleia(id); }catch(e){ toast(e.message); }
  });
  sh.querySelectorAll("[data-votop]").forEach(b=>b.addEventListener("click",async()=>{
    const [pid,uid,op]=b.dataset.votop.split(":");
    try{ await rpc("voto_por_unidade",{p_pauta:pid,p_escolha:op,p_unidade:uid}); toast("Voto registrado ✅"); abrirAssembleia(id); }catch(e){ toast(e.message); }
  }));
  sh.querySelector("[data-asst]")?.addEventListener("click",async e=>{
    try{ await rpc("assembleia_status",{p_assembleia:id,p_status:e.currentTarget.dataset.asst}); toast("Atualizado"); abrirAssembleia(id); }catch(x){ toast(x.message); }
  });
  $("#asAddPauta")?.addEventListener("click",()=>novaPauta(id));
  sh.querySelectorAll("[data-voto]").forEach(b=>b.addEventListener("click",async()=>{
    const [pid,op]=b.dataset.voto.split(":");
    try{ await rpc("voto_registrar",{p_pauta:pid,p_escolha:op}); toast("Voto registrado ✅"); abrirAssembleia(id); }catch(e){ toast(e.message); }
  }));
  sh.querySelectorAll("[data-encpauta]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("pauta_encerrar",{p_pauta:b.dataset.encpauta}); toast("Pauta encerrada"); abrirAssembleia(id); }catch(e){ toast(e.message); }
  }));
}
function novaPauta(assembleiaId){
  sheet(`<h2>Nova pauta</h2>
    <label>Título</label><input id="pTit" class="field" placeholder="Aprovação da pintura da fachada">
    <label>Descrição (opcional)</label><textarea id="pDesc" class="field" rows="3" placeholder="Detalhe a proposta a ser votada..."></textarea>
    <button class="btn" id="pSave">Adicionar pauta</button>`);
  $("#pSave").addEventListener("click",async()=>{
    const t=$("#pTit").value.trim(); if(!t) return toast("Informe o título.");
    try{ await rpc("pauta_criar",{p_assembleia:assembleiaId,p_titulo:t,p_descricao:$("#pDesc").value.trim()||null});
      toast("Pauta adicionada"); abrirAssembleia(assembleiaId);
    }catch(e){ toast(e.message); }
  });
}
function darProcuracao(assembleiaId){
  sheet(`<h2>Dar procuração</h2>
    <p class="sub">Delegue seu voto a outro morador deste condomínio para esta assembleia. Ele poderá votar em nome da sua unidade nas pautas.</p>
    <label>E-mail do procurador</label><input id="prEmail" class="field" type="email" placeholder="morador@email.com">
    <button class="btn" id="prSave">Confirmar procuração</button>`);
  $("#prSave").addEventListener("click",async()=>{
    const email=$("#prEmail").value.trim(); if(!email) return toast("Informe o e-mail.");
    $("#prSave").disabled=true;
    try{ await rpc("procuracao_outorgar",{p_assembleia:assembleiaId,p_email:email}); closeSheet(); toast("Procuração concedida 📜"); abrirAssembleia(assembleiaId); }
    catch(e){ $("#prSave").disabled=false; toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: DOCUMENTOS (Supabase Storage)
// ===================================================================
const DOC_CAT = {convencao:"Convenção",regulamento:"Regulamento",ata:"Ata",financeiro:"Financeiro",comunicado:"Comunicado",geral:"Geral"};
// fmtBytes: em ./helpers.js
async function renderDocumentos(){
  loading();
  let docs=[];
  try{
    const {data,error}=await sb.from("documentos").select("*").eq("condominio_id",S.condId).order("created_at",{ascending:false});
    if(error) throw error; docs=data||[];
  }catch(e){ view().innerHTML=`<p class="empty">Erro: ${esc(e.message)}</p>`; return; }
  const sindico=isSindico(S.role);
  const gestor=isGestor(S.role);
  // aceites: membro vê os seus; gestor vê todos (RLS)
  const {data:aceites}=await sb.from("documento_aceites").select("documento_id,user_id");
  const meusAceites=new Set((aceites||[]).filter(a=>a.user_id===S.user.id).map(a=>a.documento_id));
  const contaAceites={}; (aceites||[]).forEach(a=>{ contaAceites[a.documento_id]=(contaAceites[a.documento_id]||0)+1; });
  let html=`<div class="subhead"><button class="back" id="dBack">‹</button>
    <div class="h" style="margin:0">Documentos <small>Convenção, regulamento, atas e mais</small></div></div>`;
  if(sindico) html+=`<button class="btn secondary" id="dEnviar" style="margin-bottom:14px">➕ Enviar documento</button>`;
  if(!docs.length){
    html+=emptyBox("📄","Nenhum documento.",sindico?"Envie a convenção, o regulamento e as atas.":"Quando o síndico publicar documentos, aparecem aqui.");
  }else{
    html+=docs.map(d=>{
      const aceito=meusAceites.has(d.id);
      let aceiteBloco="";
      if(d.requer_aceite){
        aceiteBloco = aceito
          ? `<div class="meta" style="margin-top:8px"><span class="badge resolvida">✅ Você aceitou</span></div>`
          : `<button class="btn" data-aceitar="${d.id}" style="margin-top:10px">✍️ Li e concordo</button>`;
      }
      const gestorAceite = gestor && d.requer_aceite
        ? `<span class="badge">✅ ${contaAceites[d.id]||0} aceite(s)</span>` : "";
      return `<div class="tile" style="padding:14px">
      <div class="row"><span style="font-size:22px">📄</span>
        <div style="flex:1;min-width:0"><h3 style="font-size:15px">${esc(d.nome)}</h3>
          <div class="meta"><span class="badge">${DOC_CAT[d.categoria]||d.categoria}</span>${d.requer_aceite?'<span class="badge aberta">Requer aceite</span>':""}${gestorAceite}${d.tamanho?`<span>${fmtBytes(d.tamanho)}</span>`:""}<span>🕒 ${fmtDate(d.created_at)}</span></div></div></div>
      ${aceiteBloco}
      <div class="seg" style="margin-top:10px">
        <button class="btn" data-abrir="${esc(d.storage_path)}" style="width:auto;margin:0;padding:9px 16px">📥 Abrir</button>
        ${sindico?`<button class="badge" data-reqaceite="${d.id}:${d.requer_aceite?0:1}" style="align-self:center;cursor:pointer">${d.requer_aceite?"Não exigir aceite":"Exigir aceite"}</button>`:""}
        ${sindico?`<button class="badge" data-deldoc="${d.id}:${esc(d.storage_path)}" style="align-self:center;background:#fdecea;color:var(--danger)">Excluir</button>`:""}</div>
    </div>`;
    }).join("");
  }
  view().innerHTML=html; $("#fab").classList.add("hide");
  $("#dBack").addEventListener("click",()=>go("servicos"));
  $("#dEnviar")?.addEventListener("click",enviarDocumento);
  view().querySelectorAll("[data-abrir]").forEach(b=>b.addEventListener("click",()=>abrirDocumento(b.dataset.abrir)));
  view().querySelectorAll("[data-aceitar]").forEach(b=>b.addEventListener("click",async()=>{
    if(!(await confirmar("Confirmar que leu e concorda com este documento?","Li e concordo"))) return;
    try{ await rpc("documento_aceitar",{p_documento:b.dataset.aceitar}); toast("Aceite registrado ✍️"); renderDocumentos(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-reqaceite]").forEach(b=>b.addEventListener("click",async()=>{
    const [id,req]=b.dataset.reqaceite.split(":");
    try{ await rpc("documento_definir_aceite",{p_documento:id,p_requer:req==="1"}); renderDocumentos(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-deldoc]").forEach(b=>b.addEventListener("click",async()=>{
    if(!(await confirmar("Excluir este documento?","Excluir"))) return;
    const [id,path]=b.dataset.deldoc.split(":");
    try{ await rpc("documento_excluir",{p_documento:id}); await sb.storage.from("documentos").remove([path]); toast("Documento excluído"); renderDocumentos(); }
    catch(e){ toast(e.message); }
  }));
}
function enviarDocumento(){
  let cat="geral";
  const cats=Object.entries(DOC_CAT).map(([k,v])=>`<button data-c="${k}" class="${k==="geral"?"on":""}">${v}</button>`).join("");
  sheet(`<h2>Enviar documento</h2>
    <label>Arquivo</label><input id="dArq" class="field" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg">
    <label>Nome de exibição</label><input id="dNome" class="field" placeholder="Convenção do condomínio">
    <label>Categoria</label><div class="seg" id="dCat">${cats}</div>
    <button class="btn" id="dSave">Enviar</button>`);
  $("#dCat").querySelectorAll("[data-c]").forEach(b=>b.addEventListener("click",()=>{
    cat=b.dataset.c; $("#dCat").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
  }));
  $("#dArq").addEventListener("change",e=>{ const f=e.target.files?.[0]; if(f && !$("#dNome").value) $("#dNome").value=f.name.replace(/\.[^.]+$/,""); });
  $("#dSave").addEventListener("click",async()=>{
    const f=$("#dArq").files?.[0]; if(!f) return toast("Escolha um arquivo.");
    const nome=$("#dNome").value.trim()||f.name;
    const safe=f.name.replace(/[^a-zA-Z0-9.\-_]/g,"_");
    const path=`${S.condId}/${crypto.randomUUID()}-${safe}`;
    $("#dSave").disabled=true; toast("Enviando...");
    try{
      const up=await sb.storage.from("documentos").upload(path,f,{contentType:f.type||"application/octet-stream",upsert:false});
      if(up.error) throw up.error;
      await rpc("documento_registrar",{p_cond:S.condId,p_nome:nome,p_categoria:cat,p_path:path,p_tamanho:f.size,p_mime:f.type||null});
      closeSheet(); toast("Documento enviado 📄"); renderDocumentos();
    }catch(e){ $("#dSave").disabled=false; toast(e.message||"Falha no envio"); }
  });
}
async function abrirDocumento(path){
  try{
    const {data,error}=await sb.storage.from("documentos").createSignedUrl(path,120);
    if(error) throw error;
    window.open(data.signedUrl,"_blank");
  }catch(e){ toast(e.message||"Não foi possível abrir"); }
}

// ===================================================================
// MÓDULO: ENQUETES (consultas rápidas — voto por pessoa)
// ===================================================================
async function renderEnquetes(){
  loading();
  let enquetes=[];
  try{ const {data,error}=await sb.from("enquetes").select("*").eq("condominio_id",S.condId).order("created_at",{ascending:false}); if(error) throw error; enquetes=data||[]; }
  catch(e){ view().innerHTML=`<p class="empty">Erro: ${esc(e.message)}</p>`; return; }
  const results={};
  await Promise.all(enquetes.map(async q=>{ try{ results[q.id]=await rpc("enquete_resultado",{p_enquete:q.id}); }catch(_){ results[q.id]=null; } }));
  const podeCriar=isGestor(S.role);
  let html=`<div class="subhead"><button class="back" id="eqBack">‹</button><div class="h" style="margin:0">Enquetes <small>Consultas rápidas ao condomínio</small></div></div>`;
  if(podeCriar) html+=`<button class="btn secondary" id="eqNova" style="margin-bottom:14px">➕ Nova enquete</button>`;
  if(!enquetes.length){ html+=emptyBox("📊","Nenhuma enquete.",podeCriar?"Crie uma consulta rápida.":"Você será avisado quando houver uma enquete."); }
  else html+=enquetes.map(q=>{
    const r=results[q.id]||{total:0,meu_voto:null,opcoes:[]};
    const aberta=q.status==="aberta";
    const opcoes=(r.opcoes||[]).map(o=>{
      const pct=r.total?Math.round(o.votos/r.total*100):0, mine=r.meu_voto===o.id;
      return `<button ${aberta?`data-eqvote="${o.id}"`:"disabled"} style="width:100%;text-align:left;position:relative;border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:6px 0;overflow:hidden;background:var(--field-bg)">
        <div style="position:absolute;inset:0;width:${pct}%;background:${mine?'#dcefe6':'var(--chip)'};z-index:0"></div>
        <div style="position:relative;z-index:1;display:flex;justify-content:space-between;gap:8px">
          <span>${mine?"✓ ":""}${esc(o.texto)}</span><span class="sub" style="margin:0">${o.votos} · ${pct}%</span></div></button>`;
    }).join("");
    return `<div class="tile">
      <div class="row"><h3 style="flex:1">${esc(q.pergunta)}</h3>${aberta?'<span class="badge em_andamento">Aberta</span>':'<span class="badge resolvida">Encerrada</span>'}</div>
      ${q.descricao?`<p>${esc(q.descricao)}</p>`:""}
      <div style="margin-top:6px">${opcoes}</div>
      <div class="meta"><span>${r.total} voto(s)</span>${podeCriar&&aberta?`<button class="badge" data-eqenc="${q.id}" style="margin-left:auto">Encerrar</button>`:""}</div>
    </div>`;
  }).join("");
  view().innerHTML=html; $("#fab").classList.add("hide");
  $("#eqBack").addEventListener("click",()=>go("servicos"));
  $("#eqNova")?.addEventListener("click",novaEnquete);
  view().querySelectorAll("[data-eqvote]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("enquete_votar",{p_opcao:b.dataset.eqvote}); toast("Voto registrado ✅"); renderEnquetes(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-eqenc]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("enquete_encerrar",{p_enquete:b.dataset.eqenc}); toast("Enquete encerrada"); renderEnquetes(); }catch(e){ toast(e.message); }
  }));
}
function novaEnquete(){
  sheet(`<h2>Nova enquete</h2>
    <label>Pergunta</label><input id="eqP" class="field" placeholder="Aprovar horário de silêncio às 22h?">
    <label>Descrição (opcional)</label><textarea id="eqD" class="field" rows="2"></textarea>
    <label>Opções (uma por linha, mín. 2)</label>
    <textarea id="eqO" class="field" rows="4" placeholder="Sim&#10;Não&#10;Tanto faz"></textarea>
    <button class="btn" id="eqSave">Criar enquete</button>`);
  $("#eqSave").addEventListener("click",async()=>{
    const p=$("#eqP").value.trim(); if(!p) return toast("Informe a pergunta.");
    const ops=$("#eqO").value.split("\n").map(s=>s.trim()).filter(Boolean);
    if(ops.length<2) return toast("Informe pelo menos 2 opções.");
    try{ await rpc("enquete_criar",{p_cond:S.condId,p_pergunta:p,p_descricao:$("#eqD").value.trim()||null,p_opcoes:ops});
      closeSheet(); toast("Enquete criada 📊"); renderEnquetes();
    }catch(e){ toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: MANUTENÇÕES PREVENTIVAS
// ===================================================================
const MANUT_CAT={extintor:"Extintores",elevador:"Elevador",avcb:"AVCB",dedetizacao:"Dedetização",caixa_dagua:"Caixa d'água",portao:"Portão",jardim:"Jardim",limpeza:"Limpeza",outro:"Outro"};
async function renderManutencoes(){
  loading();
  let itens=[];
  try{ const {data,error}=await sb.from("manutencoes").select("*").eq("condominio_id",S.condId).eq("ativo",true).order("proxima_data"); if(error) throw error; itens=data||[]; }
  catch(e){ view().innerHTML=`<p class="empty">Erro: ${esc(e.message)}</p>`; return; }
  const sindico=isSindico(S.role);
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  let html=`<div class="subhead"><button class="back" id="mtBack">‹</button><div class="h" style="margin:0">Manutenções <small>Preventivas e obrigatórias</small></div></div>`;
  if(sindico) html+=`<button class="btn secondary" id="mtNova" style="margin-bottom:14px">➕ Nova manutenção</button>`;
  if(!itens.length){ html+=emptyBox("🔧","Nada agendado.",sindico?"Cadastre extintores, elevador, AVCB...":"O síndico ainda não cadastrou manutenções."); }
  else html+=itens.map(m=>{
    const venc=new Date(m.proxima_data+"T00:00:00"), dias=Math.round((venc-hoje)/864e5);
    const badge=dias<0?"urgente":dias<=15?"em_andamento":"resolvida";
    const label=dias<0?`Vencida há ${-dias}d`:dias===0?"Vence hoje":`Em ${dias}d`;
    return `<div class="tile">
      <div class="row"><h3 style="flex:1">${esc(m.titulo)}</h3><span class="badge ${badge}">${label}</span></div>
      <div class="meta"><span class="badge">${MANUT_CAT[m.categoria]||m.categoria}</span><span>📅 ${venc.toLocaleDateString("pt-BR")}</span>${m.fornecedor?`<span>🏢 ${esc(m.fornecedor)}</span>`:""}${m.periodicidade_meses?`<span>🔁 ${m.periodicidade_meses}m</span>`:""}</div>
      ${m.observacao?`<p>${esc(m.observacao)}</p>`:""}
      ${m.ultimo_realizado?`<div class="meta"><span>✅ última: ${new Date(m.ultimo_realizado+"T00:00:00").toLocaleDateString("pt-BR")}</span></div>`:""}
      ${sindico?`<div class="seg" style="margin-top:10px"><button class="btn" data-mtfeita="${m.id}" style="width:auto;margin:0;padding:9px 16px">✅ Marcar realizada</button><button class="badge" data-mtdel="${m.id}" style="align-self:center">Excluir</button></div>`:""}
    </div>`;
  }).join("");
  view().innerHTML=html; $("#fab").classList.add("hide");
  $("#mtBack").addEventListener("click",()=>go("servicos"));
  $("#mtNova")?.addEventListener("click",novaManutencao);
  view().querySelectorAll("[data-mtfeita]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("manutencao_realizar",{p_manutencao:b.dataset.mtfeita,p_data:null}); toast("Registrado ✅"); renderManutencoes(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-mtdel]").forEach(b=>b.addEventListener("click",async()=>{
    if(!(await confirmar("Excluir esta manutenção?","Excluir"))) return;
    try{ await rpc("manutencao_excluir",{p_manutencao:b.dataset.mtdel}); toast("Excluída"); renderManutencoes(); }catch(e){ toast(e.message); }
  }));
}
function novaManutencao(){
  let cat="extintor";
  const cats=Object.entries(MANUT_CAT).map(([k,v])=>`<button data-c="${k}" class="${k==="extintor"?"on":""}">${v}</button>`).join("");
  const prox=new Date(Date.now()+30*864e5).toISOString().slice(0,10);
  sheet(`<h2>Nova manutenção</h2>
    <label>Título</label><input id="mtTit" class="field" placeholder="Recarga de extintores">
    <label>Categoria</label><div class="seg" id="mtCat">${cats}</div>
    <label>Fornecedor (opcional)</label><input id="mtForn" class="field" placeholder="Empresa X">
    <label>Próxima data</label><input id="mtData" class="field" type="date" value="${prox}">
    <label>Periodicidade em meses (opcional)</label><input id="mtPer" class="field" type="number" min="1" placeholder="12">
    <label>Observação (opcional)</label><input id="mtObs" class="field">
    <button class="btn" id="mtSave">Cadastrar</button>`);
  $("#mtCat").querySelectorAll("[data-c]").forEach(b=>b.addEventListener("click",()=>{ cat=b.dataset.c; $("#mtCat").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); }));
  $("#mtSave").addEventListener("click",async()=>{
    const t=$("#mtTit").value.trim(); if(!t) return toast("Informe o título.");
    const d=$("#mtData").value; if(!d) return toast("Informe a data.");
    try{ await rpc("manutencao_criar",{p_cond:S.condId,p_titulo:t,p_categoria:cat,p_proxima:d,p_fornecedor:$("#mtForn").value.trim()||null,p_periodicidade:$("#mtPer").value?parseInt($("#mtPer").value,10):null,p_obs:$("#mtObs").value.trim()||null});
      closeSheet(); toast("Manutenção cadastrada 🔧"); renderManutencoes();
    }catch(e){ toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: MURAL (classificados + achados e perdidos)
// ===================================================================
const MURAL_TIPO={venda:"À venda",procura:"Procuro",servico:"Serviço",achado:"Achado",perdido:"Perdido",recado:"Recado"};
const muralBadge=t=>({venda:"resolvida",procura:"aberta",servico:"aberta",achado:"resolvida",perdido:"urgente",recado:""}[t]||"");
async function renderMural(){
  loading();
  let posts=[];
  try{ const {data,error}=await sb.from("mural_posts").select("*").eq("condominio_id",S.condId).eq("status","ativo").order("created_at",{ascending:false}); if(error) throw error; posts=data||[]; }
  catch(e){ view().innerHTML=`<p class="empty">Erro: ${esc(e.message)}</p>`; return; }
  const gestor=isGestor(S.role);
  let html=`<div class="subhead"><button class="back" id="muBack">‹</button><div class="h" style="margin:0">Mural <small>Classificados, achados e recados</small></div></div>
    <button class="btn secondary" id="muNovo" style="margin-bottom:14px">➕ Publicar no mural</button>`;
  if(!posts.length){ html+=emptyBox("📣","Mural vazio.","Seja o primeiro a publicar algo."); }
  else html+=posts.map(p=>`<div class="tile">
    <div class="row"><h3 style="flex:1">${esc(p.titulo)}</h3><span class="badge ${muralBadge(p.tipo)}">${MURAL_TIPO[p.tipo]||p.tipo}</span></div>
    ${p.corpo?`<p>${esc(p.corpo).replace(/\n/g,"<br>")}</p>`:""}
    <div class="meta">${p.preco?`<span>💰 ${fmtMoney(p.preco)}</span>`:""}${p.contato?`<span>📞 ${esc(p.contato)}</span>`:""}<span>🕒 ${fmtDate(p.created_at)}</span>
      ${(p.autor_id===S.user.id||gestor)?`<button class="badge" data-muenc="${p.id}" style="margin-left:auto">Encerrar</button>`:""}</div>
  </div>`).join("");
  view().innerHTML=html; $("#fab").classList.add("hide");
  $("#muBack").addEventListener("click",()=>go("servicos"));
  $("#muNovo").addEventListener("click",novoMural);
  view().querySelectorAll("[data-muenc]").forEach(b=>b.addEventListener("click",async()=>{
    if(!(await confirmar("Encerrar este anúncio?","Encerrar"))) return;
    try{ await rpc("mural_encerrar",{p_post:b.dataset.muenc}); toast("Encerrado"); renderMural(); }catch(e){ toast(e.message); }
  }));
}
function novoMural(){
  let tipo="venda";
  const tipos=Object.entries(MURAL_TIPO).map(([k,v])=>`<button data-t="${k}" class="${k==="venda"?"on":""}">${v}</button>`).join("");
  sheet(`<h2>Publicar no mural</h2>
    <label>Tipo</label><div class="seg" id="muT">${tipos}</div>
    <label>Título</label><input id="muTit" class="field" placeholder="Bicicleta aro 29">
    <label>Descrição</label><textarea id="muCorpo" class="field" rows="3"></textarea>
    <label>Preço R$ (opcional)</label><input id="muPreco" class="field" type="number" min="0" step="0.01">
    <label>Contato</label><input id="muContato" class="field" placeholder="WhatsApp, apartamento...">
    <button class="btn" id="muSave">Publicar</button>`);
  $("#muT").querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{ tipo=b.dataset.t; $("#muT").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); }));
  $("#muSave").addEventListener("click",async()=>{
    const t=$("#muTit").value.trim(); if(!t) return toast("Informe o título.");
    try{ await rpc("mural_publicar",{p_cond:S.condId,p_tipo:tipo,p_titulo:t,p_corpo:$("#muCorpo").value.trim()||null,p_contato:$("#muContato").value.trim()||null,p_preco:$("#muPreco").value?parseFloat($("#muPreco").value):null});
      closeSheet(); toast("Publicado 📣"); renderMural();
    }catch(e){ toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: LIVRO DE PORTARIA (registro de turno) — portaria/gestão
// ===================================================================
const PREG_TIPO={ocorrencia:"Ocorrência",entrada:"Entrada",saida:"Saída",ronda:"Ronda",observacao:"Observação"};
async function renderLivroPortaria(){
  loading();
  let regs=[];
  try{ const {data,error}=await sb.from("portaria_registros").select("*").eq("condominio_id",S.condId).order("created_at",{ascending:false}).limit(100); if(error) throw error; regs=data||[]; }
  catch(e){ view().innerHTML=`<p class="empty">Erro: ${esc(e.message)}</p>`; return; }
  let html=`<div class="subhead"><button class="back" id="lpBack">‹</button><div class="h" style="margin:0">Livro de Portaria <small>Registro de turno</small></div></div>
    <button class="btn secondary" id="lpNovo" style="margin-bottom:14px">➕ Novo registro</button>`;
  if(!regs.length){ html+=emptyBox("📒","Sem registros.","Registre ocorrências, rondas e observações do turno."); }
  else html+=regs.map(r=>`<div class="tile" style="padding:12px 14px">
    <div class="row"><span class="badge">${PREG_TIPO[r.tipo]||r.tipo}</span><span class="sub" style="margin:0 0 0 auto">${fmtDate(r.created_at)}</span></div>
    <p style="margin-top:6px">${esc(r.texto).replace(/\n/g,"<br>")}</p></div>`).join("");
  view().innerHTML=html; $("#fab").classList.add("hide");
  $("#lpBack").addEventListener("click",()=>go("servicos"));
  $("#lpNovo").addEventListener("click",novoRegistroPortaria);
}
function novoRegistroPortaria(){
  let tipo="observacao";
  const tipos=Object.entries(PREG_TIPO).map(([k,v])=>`<button data-t="${k}" class="${k==="observacao"?"on":""}">${v}</button>`).join("");
  sheet(`<h2>Novo registro</h2>
    <label>Tipo</label><div class="seg" id="lpT">${tipos}</div>
    <label>Descrição</label><textarea id="lpTxt" class="field" rows="4" placeholder="Ex.: Ronda 22h sem intercorrências."></textarea>
    <button class="btn" id="lpSave">Registrar</button>`);
  $("#lpT").querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{ tipo=b.dataset.t; $("#lpT").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); }));
  $("#lpSave").addEventListener("click",async()=>{
    const t=$("#lpTxt").value.trim(); if(!t) return toast("Escreva o registro.");
    try{ await rpc("portaria_registrar",{p_cond:S.condId,p_tipo:tipo,p_texto:t}); closeSheet(); toast("Registrado 📒"); renderLivroPortaria(); }catch(e){ toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: GESTÃO (unidades + moradores/equipe) — gestor
// ===================================================================
// unitLabel: em ./helpers.js
// ---- Assinatura VIZELLO (mensalidade SaaS paga pelo síndico via PIX) ----
async function carregarAssinaturaVizello(){
  const el=$("#assinVizello"); if(!el) return;
  let fats=[]; try{ fats=(await rpc("minha_fatura_vizello"))||[]; }catch(_){ return; }
  fats=fats.filter(f=>f.tipo==="condominio");
  if(!fats.length){ el.innerHTML=""; return; }
  el.innerHTML=`<div class="tile" style="background:#fdfce4;border-color:#ece79a;margin-bottom:16px">
    <div class="row"><span style="font-size:20px">🧾</span><div style="flex:1"><b>Assinatura VIZELLO</b><div class="sub" style="margin:2px 0 0">Mensalidade do sistema — ${fats.length} em aberto</div></div></div>
    ${fats.map(f=>`<div class="row" style="margin-top:10px;padding-top:10px;border-top:1px solid #ece79a"><span style="flex:1">${esc(f.competencia)} · <b>${fmtMoney(f.valor)}</b>${f.vencimento?` <span class="sub" style="margin:0">vence ${fmtDate(f.vencimento)}</span>`:""}</span><button class="btn" data-payfat="${f.id}" style="width:auto;margin:0;padding:8px 14px">💠 Pagar com PIX</button></div>`).join("")}</div>`;
  el.querySelectorAll("[data-payfat]").forEach(b=>b.addEventListener("click",()=>pagarMensalidadeVizello(b.dataset.payfat)));
}
async function pagarMensalidadeVizello(id){
  sheet(`<h2>💠 Mensalidade VIZELLO</h2><div class="spin"></div>`);
  try{
    const { data, error } = await sb.functions.invoke("cobrar-mensalidade",{ body:{ fatura_id:id } });
    if(error||!data||data.error) throw new Error((data&&data.error)||error?.message||"Falha ao gerar PIX");
    const qr=data.qr_code, qr64=data.qr_code_base64;
    sheet(`<h2>💠 Mensalidade VIZELLO</h2><p class="sub">Pague com PIX (copia-e-cola ou QR). A baixa é automática.</p>
      ${qr64?`<div style="text-align:center"><img alt="QR PIX" src="data:image/png;base64,${qr64}" style="width:220px;max-width:70%"></div>`:""}
      ${qr?`<div style="font-size:12px;word-break:break-all;background:var(--chip);padding:10px;border-radius:10px;margin-top:8px">${esc(qr)}</div>
      <button class="btn" id="fatCopy" style="margin-top:10px">📋 Copiar código PIX</button>`:'<p class="empty">PIX indisponível. Tente novamente em instantes.</p>'}`);
    $("#fatCopy")?.addEventListener("click",()=>{ try{ navigator.clipboard.writeText(qr); toast("Código copiado ✅"); }catch(_){ toast("Copie o código manualmente."); } });
  }catch(e){ closeSheet(); toast(e.message||"Erro"); }
}
async function renderGestao(){
  loading();
  const podeEditar = isSindico(S.role);
  let unids=[], membros=[], convites=[];
  try{
    const [u,m,c] = await Promise.all([
      sb.from("unidades").select("id,bloco,numero,fracao_ideal").eq("condominio_id",S.condId).order("numero"),
      rpc("cond_membros",{p_cond:S.condId}),
      rpc("cond_convites_pendentes",{p_cond:S.condId})
    ]);
    unids=u.data||[]; membros=m||[]; convites=c||[];
  }catch(e){ view().innerHTML=`<p class="empty">Erro: ${esc(e.message)}</p>`; return; }
  S._unids=unids;
  const {data:sancoes}=await sb.from("sancoes").select("*").eq("condominio_id",S.condId).order("created_at",{ascending:false});
  const unMapG={}; unids.forEach(u=>unMapG[u.id]=unitLabel(u.bloco,u.numero));

  let html=`<div class="h">Gestão <small>Unidades, moradores e equipe</small></div>`;
  html+=`<div id="assinVizello"></div>`;

  // Unidades
  html+=`<div class="row" style="justify-content:space-between;align-items:center;margin:2px 2px 8px">
      <b>🏠 Unidades (${unids.length})</b>
      ${podeEditar?`<button class="badge" id="gAddUnit">➕ Nova</button>`:""}</div>`;
  if(!unids.length){
    html+=`<p class="sub" style="margin:0 2px 4px">Nenhuma unidade cadastrada.</p>`;
  }else{
    const countByUnit={}; membros.forEach(m=>{ if(m.unidade_id) countByUnit[m.unidade_id]=(countByUnit[m.unidade_id]||0)+1; });
    html+=`<div class="tile" style="padding:4px 0">`+unids.map((u,i)=>`<div class="row" style="padding:11px 14px;${i<unids.length-1?"border-bottom:1px solid var(--line)":""}">
      <span style="flex:1;min-width:0">🏠 ${esc(unitLabel(u.bloco,u.numero))}${u.fracao_ideal!=null?` <span class="sub" style="margin:0">· fração ${(+u.fracao_ideal).toLocaleString("pt-BR")}</span>`:""}</span>
      <span class="sub" style="margin:0 8px 0 0">${countByUnit[u.id]||0} morador(es)</span>
      ${podeEditar?`<button class="badge" data-frac="${u.id}" style="cursor:pointer">⚖️ Fração</button>`:""}</div>`).join("")+`</div>`;
    if(podeEditar) html+=`<p class="sub" style="margin:6px 2px 0">A fração ideal habilita o voto ponderado nas assembleias.</p>`;
  }

  // Moradores e equipe
  html+=`<div class="row" style="justify-content:space-between;align-items:center;margin:20px 2px 8px">
      <b>👥 Moradores e equipe (${membros.length})</b>
      ${podeEditar?`<button class="badge" id="gInvite">➕ Convidar</button>`:""}</div>`;
  if(!membros.length){
    html+=`<p class="sub" style="margin:0 2px">Ninguém vinculado ainda.</p>`;
  }else{
    html+=membros.map(m=>`<div class="tile" style="padding:12px 14px">
      <div class="row"><h3 style="flex:1;font-size:15px">${esc(m.nome||m.email||"—")}</h3>
        <span class="badge">${esc(ROLE_LABEL[m.role]||m.role)}</span></div>
      <div class="meta">
        ${m.email?`<span>📧 ${esc(m.email)}</span>`:""}
        ${m.numero?`<span>🏠 ${esc(unitLabel(m.bloco,m.numero))}</span>`:""}
        ${m.vinculo?`<span>${esc(VINCULO_LABEL[m.vinculo]||m.vinculo)}</span>`:""}
        ${(podeEditar && m.role!=="super_admin")?`<button class="badge" data-rmv="${m.membership_id}" style="margin-left:auto;background:#fdecea;color:var(--danger)">Remover</button>`:""}
      </div></div>`).join("");
  }

  // Convites pendentes
  if(convites.length){
    html+=`<div class="row" style="margin:20px 2px 8px"><b>✉️ Convites pendentes (${convites.length})</b></div>`;
    html+=convites.map(c=>`<div class="tile" style="padding:12px 14px">
      <div class="row"><h3 style="flex:1;font-size:15px">${esc(c.email)}</h3><span class="badge">${esc(ROLE_LABEL[c.role]||c.role)}</span></div>
      <div class="meta"><span>⏳ Aguardando cadastro</span>
        ${c.numero?`<span>🏠 ${esc(unitLabel(c.bloco,c.numero))}</span>`:""}
        ${podeEditar?`<button class="badge" data-cancc="${c.id}" style="margin-left:auto">Cancelar</button>`:""}</div></div>`).join("");
  }

  // Multas e advertências
  const sancAtivas=(sancoes||[]).filter(s=>s.status==="ativa");
  html+=`<div class="row" style="justify-content:space-between;align-items:center;margin:20px 2px 8px">
      <b>⚠️ Multas e advertências (${sancAtivas.length})</b>
      ${podeEditar?`<button class="badge" id="gSancao">➕ Aplicar</button>`:""}</div>`;
  if(!(sancoes||[]).length){
    html+=`<p class="sub" style="margin:0 2px">Nenhuma sanção registrada.</p>`;
  }else{
    html+=(sancoes||[]).map(s=>`<div class="tile" style="padding:12px 14px">
      <div class="row"><span style="font-size:18px">${s.tipo==="multa"?"⚠️":"📄"}</span>
        <h3 style="flex:1;font-size:15px">${esc(s.motivo)}</h3>
        <span class="badge ${s.status==="cancelada"?"cancelada":s.tipo==="multa"?"urgente":"em_andamento"}">${s.status==="cancelada"?"Cancelada":s.tipo==="multa"?"Multa":"Advertência"}</span></div>
      <div class="meta"><span>🏠 ${esc(unMapG[s.unidade_id]||"—")}</span>${s.valor?`<span>💰 ${fmtMoney(s.valor)}</span>`:""}${s.cobranca_id?`<span>🧾 cobrança gerada</span>`:""}<span>🕒 ${fmtDate(s.created_at)}</span></div>
      ${s.descricao?`<p style="margin-top:6px">${esc(s.descricao)}</p>`:""}
      ${s.defesa_status?`<div class="meta"><span class="badge ${s.defesa_status==="enviada"?"em_andamento":s.defesa_status==="deferida"?"resolvida":"urgente"}">${({enviada:"📝 Defesa a analisar",deferida:"✅ Defesa aceita",indeferida:"❌ Defesa indeferida"})[s.defesa_status]}</span></div>`:""}
      <div class="meta">
        ${s.defesa_texto?`<button class="badge" data-vdef="${s.id}" style="cursor:pointer">${s.defesa_status==="enviada"&&podeEditar?"Analisar defesa":"Ver defesa"}</button>`:""}
        ${(podeEditar&&s.status==="ativa")?`<button class="badge cancelada" data-cancsanc="${s.id}" style="cursor:pointer">Cancelar sanção</button>`:""}
      </div>
    </div>`).join("");
  }

  view().innerHTML=html; $("#fab").classList.add("hide");
  if(isSindico(S.role)) carregarAssinaturaVizello();
  $("#gAddUnit")?.addEventListener("click",cadastrarUnidade);
  $("#gInvite")?.addEventListener("click",convidarPessoa);
  $("#gSancao")?.addEventListener("click",()=>aplicarSancao(unids));
  view().querySelectorAll("[data-vdef]").forEach(b=>b.addEventListener("click",()=>analisarDefesa(b.dataset.vdef)));
  view().querySelectorAll("[data-cancsanc]").forEach(b=>b.addEventListener("click",async()=>{
    if(!(await confirmar("Cancelar esta sanção? A cobrança vinculada (se houver e em aberto) também é cancelada.","Cancelar"))) return;
    try{ await rpc("sancao_cancelar",{p_id:b.dataset.cancsanc}); toast("Sanção cancelada"); renderGestao(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-frac]").forEach(b=>b.addEventListener("click",()=>{
    const u=(S._unids||[]).find(x=>x.id===b.dataset.frac); if(!u) return;
    sheet(`<h2>Fração ideal</h2><p class="sub" style="margin:2px 0 4px">Unidade ${esc(unitLabel(u.bloco,u.numero))}. Informe a fração ideal (ex.: 0,0125 ou 1.25). Deixe vazio para remover.</p>
      <input id="frVal" class="field" inputmode="decimal" placeholder="0,0125" value="${u.fracao_ideal!=null?String(u.fracao_ideal).replace('.',','):""}">
      <button class="btn" id="frSave">Salvar</button>`);
    $("#frSave").addEventListener("click",async()=>{
      const raw=$("#frVal").value.trim().replace(/\./g,"").replace(",",".");
      const val=raw===""?null:Number(raw);
      if(val!=null && (isNaN(val)||val<0)) return toast("Valor inválido.");
      try{ await rpc("unidade_fracao",{p_unidade:u.id,p_fracao:val}); closeSheet(); toast("Fração salva ⚖️"); renderGestao(); }catch(e){ toast(e.message); }
    });
  }));
  view().querySelectorAll("[data-rmv]").forEach(b=>b.addEventListener("click",async()=>{
    if(!(await confirmar("Remover esta pessoa do condomínio?","Remover"))) return;
    try{ await rpc("membership_remover",{p_membership:b.dataset.rmv}); toast("Removido"); renderGestao(); }catch(e){ toast(e.message); }
  }));
  view().querySelectorAll("[data-cancc]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("convite_cancelar",{p_convite:b.dataset.cancc}); toast("Convite cancelado"); renderGestao(); }catch(e){ toast(e.message); }
  }));
}
function aplicarSancao(unids){
  if(!unids||!unids.length) return toast("Cadastre unidades primeiro.");
  let tipo="advertencia";
  const hoje=new Date(); const venc=new Date(hoje.getTime()+10*86400000).toISOString().slice(0,10);
  sheet(`<h2>Aplicar sanção</h2>
    <label>Unidade</label><select id="scUnid" class="field">${unids.map(u=>`<option value="${u.id}">${esc(unitLabel(u.bloco,u.numero))}</option>`).join("")}</select>
    <label>Tipo</label><div class="seg" id="scTipo">
      <button data-t="advertencia" class="on">📄 Advertência</button>
      <button data-t="multa">⚠️ Multa</button></div>
    <label>Motivo</label><input id="scMotivo" class="field" placeholder="Ex.: Barulho após 22h (art. 12 do regulamento)">
    <label>Descrição (opcional)</label><textarea id="scDesc" class="field" rows="2" placeholder="Detalhes da infração..."></textarea>
    <div id="scMultaFields" style="display:none">
      <div style="display:flex;gap:10px"><div style="flex:1"><label>Valor (R$)</label><input id="scValor" class="field" inputmode="decimal" placeholder="0,00"></div>
        <div style="flex:1"><label>Vencimento</label><input id="scVenc" class="field" type="date" value="${venc}"></div></div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" id="scGerar" checked style="width:auto"> Gerar cobrança no financeiro</label>
    </div>
    <button class="btn" id="scSave">Aplicar</button>`);
  const toggle=()=>{ $("#scMultaFields").style.display = tipo==="multa"?"block":"none"; };
  $("#scTipo").querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{ tipo=b.dataset.t; $("#scTipo").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); toggle(); }));
  $("#scSave").addEventListener("click",async()=>{
    const motivo=$("#scMotivo").value.trim(); if(!motivo) return toast("Informe o motivo.");
    let valor=null, gerar=false;
    if(tipo==="multa"){
      gerar=$("#scGerar").checked;
      const raw=$("#scValor").value.trim().replace(/\./g,"").replace(",",".");
      valor=raw===""?null:Number(raw);
      if(valor!=null&&(isNaN(valor)||valor<0)) return toast("Valor inválido.");
      if(gerar&&(!valor||valor<=0)) return toast("Informe o valor da multa para gerar cobrança.");
    }
    $("#scSave").disabled=true;
    try{
      await rpc("sancao_aplicar",{p_cond:S.condId,p_unidade:$("#scUnid").value,p_tipo:tipo,p_motivo:motivo,
        p_descricao:$("#scDesc").value.trim()||null,p_valor:valor,
        p_vencimento:tipo==="multa"?($("#scVenc").value||null):null,p_gerar_cobranca:gerar});
      closeSheet(); toast(tipo==="multa"?"Multa aplicada ⚠️":"Advertência registrada 📄"); renderGestao();
    }catch(e){ $("#scSave").disabled=false; toast(e.message); }
  });
}
// gestor analisa/responde a defesa de uma sanção
async function analisarDefesa(id){
  const {data:s}=await sb.from("sancoes").select("*").eq("id",id).single();
  if(!s) return toast("Sanção não encontrada.");
  const anexMap=await fetchAnexos("sancao",[id]); const anex=anexMap[id]||[];
  const podeResponder=isSindico(S.role) && s.defesa_status==="enviada" && s.status==="ativa";
  let dec="indeferida";
  let h=`<h2>${s.tipo==="multa"?"⚠️ Multa":"📄 Advertência"}</h2>
    <p class="sub" style="margin:2px 0 8px">${esc(s.motivo)}</p>
    ${s.descricao?`<p style="line-height:1.5">${esc(s.descricao)}</p>`:""}
    <label style="margin-top:14px">Defesa apresentada</label>
    <div class="tile" style="margin:6px 0"><p style="line-height:1.5">${esc(s.defesa_texto||"—")}</p>${anexoThumbs(anex)}
      <div class="meta"><span>🕒 ${fmtDate(s.defesa_em)}</span></div></div>`;
  if(s.defesa_resposta || s.defesa_status==="deferida" || s.defesa_status==="indeferida"){
    h+=`<label>Decisão da gestão</label><div class="tile" style="margin:6px 0">
      <span class="badge ${s.defesa_status==="deferida"?"resolvida":"urgente"}">${s.defesa_status==="deferida"?"✅ Deferida (sanção cancelada)":"❌ Indeferida (mantida)"}</span>
      ${s.defesa_resposta?`<p style="margin-top:8px">${esc(s.defesa_resposta)}</p>`:""}<div class="meta"><span>🕒 ${fmtDate(s.respondida_em)}</span></div></div>`;
  }
  if(podeResponder){
    h+=`<label style="margin-top:14px">Sua resposta (opcional)</label>
      <textarea id="rdTxt" class="field" rows="3" placeholder="Justifique a decisão..."></textarea>
      <label>Decisão</label><div class="seg" id="rdDec">
        <button data-d="indeferida" class="on">❌ Indeferir (manter)</button>
        <button data-d="deferida">✅ Deferir (cancelar)</button></div>
      <button class="btn" id="rdSave" style="margin-top:12px">Registrar decisão</button>`;
  }
  sheet(h);
  $("#rdDec")?.querySelectorAll("[data-d]").forEach(b=>b.addEventListener("click",()=>{
    dec=b.dataset.d; $("#rdDec").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
  }));
  $("#rdSave")?.addEventListener("click",async()=>{
    $("#rdSave").disabled=true;
    try{ await rpc("sancao_responder_defesa",{p_id:id,p_resposta:$("#rdTxt").value.trim()||null,p_decisao:dec});
      closeSheet(); toast(dec==="deferida"?"Defesa aceita — sanção cancelada":"Defesa indeferida"); renderGestao();
    }catch(e){ $("#rdSave").disabled=false; toast(e.message); }
  });
}
// morador contesta / acompanha a defesa da própria sanção
async function abrirDefesaMorador(id){
  const {data:s}=await sb.from("sancoes").select("*").eq("id",id).single();
  if(!s) return toast("Não encontrada.");
  const anexMap=await fetchAnexos("sancao",[id]); const anex=anexMap[id]||[];
  const defLbl={enviada:"⏳ Em análise pela gestão",deferida:"✅ Aceita — sanção cancelada",indeferida:"❌ Indeferida — sanção mantida"}[s.defesa_status];
  let h=`<h2>${s.tipo==="multa"?"⚠️ Multa":"📄 Advertência"}</h2>
    <p class="sub" style="margin:2px 0 8px">${esc(s.motivo)}</p>
    ${s.descricao?`<p style="line-height:1.5">${esc(s.descricao)}</p>`:""}
    ${s.valor?`<div class="meta"><span>💰 ${fmtMoney(s.valor)}</span>${s.cobranca_id?`<span>🧾 no financeiro</span>`:""}</div>`:""}`;
  if(s.defesa_status){
    h+=`<label style="margin-top:14px">Sua defesa</label>
      <div class="tile" style="margin:6px 0"><p style="line-height:1.5">${esc(s.defesa_texto||"")}</p>${anexoThumbs(anex)}
        <div class="meta"><span>🕒 ${fmtDate(s.defesa_em)}</span><span class="badge">${defLbl}</span></div></div>`;
    if(s.defesa_resposta) h+=`<label>Resposta da gestão</label><div class="tile" style="margin:6px 0"><p style="line-height:1.5">${esc(s.defesa_resposta)}</p><div class="meta"><span>🕒 ${fmtDate(s.respondida_em)}</span></div></div>`;
  }else if(s.status==="ativa"){
    h+=`<label style="margin-top:14px">Contestar (defesa)</label>
      <textarea id="dfTxt" class="field" rows="4" placeholder="Explique por que discorda desta sanção..."></textarea>
      <label>Anexos (opcional)</label><input id="dfArq" class="field" type="file" accept="image/*,.pdf" multiple>
      <button class="btn" id="dfSave" style="margin-top:12px">Enviar defesa</button>`;
  }else{
    h+=`<p class="sub" style="margin-top:12px">Esta sanção está ${esc(s.status)}.</p>`;
  }
  sheet(h);
  $("#dfSave")?.addEventListener("click",async()=>{
    const t=$("#dfTxt").value.trim(); if(!t) return toast("Escreva sua defesa.");
    $("#dfSave").disabled=true;
    try{
      await rpc("sancao_defender",{p_id:id,p_texto:t});
      const files=$("#dfArq").files; if(files&&files.length){ toast("Enviando anexos..."); await uploadAnexos("sancao",id,files); }
      closeSheet(); toast("Defesa enviada 📝"); renderPerfil();
    }catch(e){ $("#dfSave").disabled=false; toast(e.message); }
  });
}
function convidarPessoa(){
  let role="morador", vinculo="proprietario";
  const roleBtns=[["morador","Morador"],["portaria","Portaria"],["conselho","Conselho"],["sindico","Síndico"]]
    .map(([k,v])=>`<button data-r="${k}" class="${k==="morador"?"on":""}">${v}</button>`).join("");
  const vincBtns=Object.entries(VINCULO_LABEL).map(([k,v])=>`<button data-v="${k}" class="${k==="proprietario"?"on":""}">${v}</button>`).join("");
  sheet(`<h2>Convidar pessoa</h2>
    <p class="sub">Se já tiver conta, é vinculada na hora. Senão, entra automaticamente ao se cadastrar com este e-mail.</p>
    <label>E-mail</label><input id="iEmail" class="field" type="email" placeholder="pessoa@email.com">
    <label>Papel</label><div class="seg" id="iRole">${roleBtns}</div>
    <div id="iMoradorFields">
      <label>Unidade</label><select id="iUnid" class="field"><option value="">— sem unidade —</option>${unitOptions()}</select>
      <label>Vínculo</label><div class="seg" id="iVinc">${vincBtns}</div>
    </div>
    <button class="btn" id="iSave">Convidar</button>`);
  const toggleMorador=()=>{ $("#iMoradorFields").style.display = role==="morador" ? "block" : "none"; };
  $("#iRole").querySelectorAll("[data-r]").forEach(b=>b.addEventListener("click",()=>{
    role=b.dataset.r; $("#iRole").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); toggleMorador();
  }));
  $("#iVinc").querySelectorAll("[data-v]").forEach(b=>b.addEventListener("click",()=>{
    vinculo=b.dataset.v; $("#iVinc").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
  }));
  $("#iSave").addEventListener("click",async()=>{
    const email=$("#iEmail").value.trim(); if(!email) return toast("Informe o e-mail.");
    const unid = role==="morador" ? ($("#iUnid").value||null) : null;
    const vinc = role==="morador" ? vinculo : null;
    try{
      const r=await rpc("membership_convidar",{p_cond:S.condId,p_email:email,p_role:role,p_unidade:unid,p_vinculo:vinc});
      closeSheet();
      toast(r?.status==="vinculado" ? "Pessoa vinculada ✅" : "Convite registrado ✉️");
      renderGestao();
    }catch(e){ toast(e.message); }
  });
}

// ===================================================================
// MÓDULO: PERFIL (+ autorizar visitante p/ morador)
// ===================================================================
async function renderPerfil(){
  loading();
  const {data:prof}=await sb.from("profiles").select("*").eq("id",S.user.id).maybeSingle();
  let mfaOn=false; try{ const {data:mf}=await sb.auth.mfa.listFactors(); mfaOn=(mf?.totp||[]).some(x=>x.status==="verified"); }catch(_){}
  let html=`<div class="h">Perfil</div>
    <div class="tile"><label>Nome</label><input id="pfNome" class="field" value="${esc(prof?.nome||"")}" placeholder="Seu nome">
      <label>Telefone</label><input id="pfTel" class="field" value="${esc(prof?.telefone||"")}" placeholder="(24) 90000-0000">
      <button class="btn" id="pfSave">Salvar</button></div>
    <div class="tile"><div class="meta"><span>📧 ${esc(S.user.email)}</span><span>🏢 ${esc(S.cond.nome)}</span><span class="badge">${ROLE_LABEL[S.role]}</span></div></div>`;

  // Segurança / 2FA
  html+=`<div class="h" style="margin-top:22px">Segurança</div>
    <div class="tile"><div class="row"><div style="flex:1">
      <b>Verificação em duas etapas</b>
      <p style="margin-top:2px">${mfaOn?"✅ Ativa — pedimos um código do app ao entrar.":"Proteja a conta com um app autenticador (Google Authenticator, Authy...)."}</p></div></div>
      <button class="btn ${mfaOn?"ghost":"secondary"}" id="pfMfa" style="margin-top:12px">${mfaOn?"Desativar 2FA":"🔐 Ativar 2FA"}</button></div>`;

  // Morador: minhas advertências/multas (só se houver)
  if(S.unidadeId){
    const {data:minhasSanc}=await sb.from("sancoes").select("*").eq("unidade_id",S.unidadeId).eq("status","ativa").order("created_at",{ascending:false});
    if(minhasSanc&&minhasSanc.length){
      html+=`<div class="h" style="margin-top:22px">Advertências e multas</div>`+minhasSanc.map(s=>{
        const defLbl={enviada:"⏳ Defesa em análise",deferida:"✅ Defesa aceita",indeferida:"❌ Defesa indeferida"}[s.defesa_status];
        return `<div class="tile" style="padding:12px 14px;border-color:${s.tipo==="multa"?"var(--warn)":"var(--line)"}">
        <div class="row"><span style="font-size:18px">${s.tipo==="multa"?"⚠️":"📄"}</span><h3 style="flex:1;font-size:15px">${esc(s.motivo)}</h3>
          <span class="badge ${s.tipo==="multa"?"urgente":"em_andamento"}">${s.tipo==="multa"?"Multa":"Advertência"}</span></div>
        ${s.descricao?`<p style="margin-top:6px">${esc(s.descricao)}</p>`:""}
        <div class="meta">${s.valor?`<span>💰 ${fmtMoney(s.valor)}</span>`:""}${s.cobranca_id?`<span>🧾 no financeiro</span>`:""}<span>🕒 ${fmtDate(s.created_at)}</span>${defLbl?`<span class="badge">${defLbl}</span>`:""}</div>
        <button class="btn secondary" data-defsanc="${s.id}" style="margin-top:10px">${s.defesa_status?"Ver defesa":"📝 Contestar / anexar defesa"}</button>
        </div>`;}).join("");
    }
  }

  // Morador: meu QR de acesso
  html+=`<div class="h" style="margin-top:22px">Meu acesso <small>Seu QR pessoal para a portaria</small></div>
    <button class="btn secondary" id="pfAcesso">🪪 Meu QR de acesso</button>`;

  // Morador: autorizar visitante
  html+=`<div class="h" style="margin-top:22px">Meus visitantes <small>Pré-autorize e passe o código na portaria</small></div>
    <button class="btn secondary" id="pfVis">➕ Autorizar visitante</button><div id="pfVisList" style="margin-top:12px"></div>`;
  html+=`<button class="btn secondary" id="pfTema" style="margin-top:18px">${currentTheme()==="dark"?"☀️ Modo claro":"🌙 Modo escuro"}</button>`;
  if(!isStandalone()) html+=`<button class="btn secondary" id="pfInstall" style="margin-top:10px">📲 Instalar o app no aparelho</button>`;
  if(pushSuportado()) html+=`<button class="btn secondary" id="pfPush" style="margin-top:10px">🔔 Ativar notificações no aparelho</button>`;
  html+=`<button class="btn secondary" id="pfPriv" style="margin-top:10px">🔒 Privacidade e meus dados</button>`;
  html+=`<button class="btn ghost" id="pfOut" style="margin-top:12px">Sair da conta</button>`;
  view().innerHTML=html; $("#fab").classList.add("hide");

  $("#pfSave").addEventListener("click",async()=>{
    try{ await rpc("perfil_salvar",{p_nome:$("#pfNome").value.trim(),p_telefone:$("#pfTel").value.trim()||null}); toast("Perfil salvo ✅"); }catch(e){ toast(e.message); }
  });
  $("#pfOut").addEventListener("click",logout);
  $("#pfMfa")?.addEventListener("click",()=> mfaOn ? desativarMFA() : ativarMFA());
  $("#pfInstall")?.addEventListener("click",promptInstall);
  $("#pfPush")?.addEventListener("click",ativarPush);
  $("#pfPriv")?.addEventListener("click",abrirPrivacidade);
  $("#pfTema")?.addEventListener("click",()=>{ toggleTheme(); renderPerfil(); });
  $("#pfAcesso")?.addEventListener("click",mostrarMeuAcesso);
  $("#pfVis").addEventListener("click",autorizarVisitante);
  view().querySelectorAll("[data-defsanc]").forEach(b=>b.addEventListener("click",()=>abrirDefesaMorador(b.dataset.defsanc)));

  // lista de visitantes do morador
  const {data:vis}=await sb.from("visitantes").select("*").eq("autorizado_por",S.user.id).order("created_at",{ascending:false}).limit(10);
  const visMap={}; (vis||[]).forEach(v=>{ visMap[v.codigo]=v; });
  $("#pfVisList").innerHTML=(vis||[]).map(v=>`<div class="tile" style="padding:12px">
    <div class="row"><h3 style="flex:1">${esc(v.nome_visitante)}</h3><span class="badge ${v.status}">${v.status}</span></div>
    <div class="meta"><span>🔑 <b>${esc(v.codigo)}</b></span>${v.data_visita?`<span>📅 ${esc(v.data_visita)}</span>`:""}${v.validade_ate?`<span>⏳ até ${fmtDate(v.validade_ate)}</span>`:""}
    <button class="badge" data-qrv="${esc(v.codigo)}">📷 QR</button>
    <button class="badge" data-wav="${esc(v.codigo)}" style="background:#25d366;color:#fff">📲 WhatsApp</button>
    ${v.status==="autorizado"?`<button class="badge" data-cancv="${v.id}" style="margin-left:auto">Cancelar</button>`:""}</div></div>`).join("");
  $("#pfVisList").querySelectorAll("[data-qrv]").forEach(b=>b.addEventListener("click",()=>mostrarQRVisitante(visMap[b.dataset.qrv]||b.dataset.qrv)));
  $("#pfVisList").querySelectorAll("[data-wav]").forEach(b=>b.addEventListener("click",()=>enviarWhatsAppVisitante(visMap[b.dataset.wav]||{codigo:b.dataset.wav})));
  $("#pfVisList").querySelectorAll("[data-cancv]").forEach(b=>b.addEventListener("click",async()=>{
    try{ await rpc("vis_cancelar",{p_visitante:b.dataset.cancv}); toast("Cancelado"); renderPerfil(); }catch(e){ toast(e.message); }
  }));
}
function mostrarQRVisitante(v){
  const vo=(typeof v==="string")?{codigo:v}:(v||{});
  const codigo=vo.codigo;
  const expira=vo.validade_ate?`<p class="sub" style="text-align:center;margin-top:8px">⏳ Válido até ${new Date(vo.validade_ate).toLocaleString("pt-BR")}</p>`:"";
  sheet(`<h2>QR do visitante</h2><p class="sub">Mostre na portaria para liberar a entrada.</p>
    <div class="codebox">${esc(codigo)}</div>
    <div style="text-align:center;margin-top:6px">${qrImg(codigo,7)}</div>
    ${expira}
    <button class="btn" id="qvWa" style="margin-top:12px;background:#25d366">📲 Enviar pelo WhatsApp</button>
    <button class="btn secondary" id="qvShare" style="margin-top:8px">📷 Compartilhar o QR</button>`);
  $("#qvWa").addEventListener("click",()=>enviarWhatsAppVisitante(vo));
  $("#qvShare").addEventListener("click",()=>compartilharQR(vo));
}
async function mostrarMeuAcesso(){
  sheet('<h2>Meu QR de acesso</h2><div class="spin"></div>');
  try{
    const codigo=await rpc("acesso_meu",{p_cond:S.condId});
    render(codigo);
  }catch(e){ $("#sheet").innerHTML='<div class="grab"></div><p class="sub">'+esc(e.message||"Erro")+'</p>'; }
  function render(codigo){
    sheet(`<h2>Meu QR de acesso</h2><p class="sub">Mostre este código na portaria para liberar sua entrada. É pessoal — não compartilhe.</p>
      <div class="codebox">${esc(codigo)}</div>
      <div style="text-align:center;margin-top:6px">${qrImg(codigo,7)}</div>
      <button class="btn ghost" id="acReg" style="margin-top:14px">🔄 Gerar novo código</button>`);
    $("#acReg").addEventListener("click",async()=>{
      if(!await confirmar("Gerar um novo código? O código atual deixa de valer.","Gerar novo")) return;
      try{ const novo=await rpc("acesso_regenerar",{p_cond:S.condId}); toast("Novo código gerado"); render(novo); }catch(e){ toast(e.message); }
    });
  }
}
async function autorizarVisitante(){
  // precisa da unidade do morador; se não tiver, pega a 1ª unidade do vínculo
  let unidade=S.unidadeId;
  if(!unidade){
    const {data:un}=await sb.from("unidades").select("id,bloco,numero").eq("condominio_id",S.condId).limit(1);
    unidade=un?.[0]?.id;
  }
  if(!unidade) return toast("Sua unidade ainda não foi vinculada. Fale com o síndico.");
  sheet(`<h2>Autorizar visitante</h2>
    <label>Nome do visitante</label><input id="vzNome" class="field" placeholder="Maria Souza">
    <label>Telefone / WhatsApp (opcional)</label><input id="vzTel" class="field" type="tel" inputmode="tel" placeholder="(11) 91234-5678">
    <label>Documento (opcional)</label><input id="vzDoc" class="field" placeholder="RG/CPF">
    <label>Data da visita (opcional)</label><input id="vzData" class="field" type="date">
    <label>Válido até (opcional)</label><input id="vzVal" class="field" type="datetime-local">
    <p class="sub" style="margin:4px 0 0;font-size:12px">Depois desse horário o código expira: deixa de liberar a entrada e é removido automaticamente. Deixe vazio para não expirar.</p>
    <button class="btn" id="vzSave">Gerar código</button><div id="vzOut"></div>`);
  $("#vzSave").addEventListener("click",async()=>{
    const nome=$("#vzNome").value.trim(); if(!nome) return toast("Informe o nome.");
    const tel=$("#vzTel").value.trim()||null;
    const val=$("#vzVal").value?new Date($("#vzVal").value).toISOString():null;
    try{ const cod=await rpc("vis_autorizar",{p_cond:S.condId,p_unidade:unidade,p_nome:nome,p_documento:$("#vzDoc").value.trim()||null,p_data:$("#vzData").value||null,p_validade:val,p_telefone:tel});
      const v={codigo:cod,nome_visitante:nome,telefone:tel,validade_ate:val};
      $("#vzOut").innerHTML=`<p class="sub" style="margin-top:16px;text-align:center">Passe este código (ou o QR) na portaria:</p>
        <div class="codebox">${esc(cod)}</div>
        <div style="text-align:center;margin-top:4px">${qrImg(cod,6)}</div>
        <button class="btn" id="vzWa" style="margin-top:12px;background:#25d366">📲 Enviar pelo WhatsApp</button>
        <button class="btn secondary" id="vzShare" style="margin-top:8px">📷 Compartilhar o QR</button>`;
      $("#vzWa").addEventListener("click",()=>enviarWhatsAppVisitante(v));
      $("#vzShare").addEventListener("click",()=>compartilharQR(v));
      toast("Visitante autorizado 🔑");
    }catch(e){ toast(e.message); }
  });
}
function abrirPrivacidade(){
  sheet(`<h2>🔒 Privacidade e meus dados</h2>
    <p class="sub" style="margin:2px 0 10px">Seus dados são tratados conforme a LGPD. Consulte a política completa e exerça seus direitos.</p>
    <a class="btn secondary" href="/privacidade" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">📄 Ler a Política de Privacidade</a>
    <label style="margin-top:16px">Seus direitos</label>
    <p class="sub" style="margin:2px 0">Acesso, correção, portabilidade, revogação de consentimento e exclusão dos seus dados.</p>
    <button class="btn ghost" id="pvDel" style="margin-top:8px">Solicitar exclusão dos meus dados</button>`);
  $("#pvDel").addEventListener("click",async()=>{
    if(!await confirmar("Enviar um pedido de exclusão dos seus dados para a gestão do condomínio? Eles darão andamento conforme a LGPD.","Enviar pedido")) return;
    try{
      await rpc("conversa_abrir",{p_cond:S.condId,p_destino:"gestao",p_assunto:"Solicitação de exclusão de dados (LGPD)",p_corpo:"Solicito a exclusão dos meus dados pessoais nos termos da LGPD."});
      closeSheet(); toast("Pedido enviado à gestão 📨");
    }catch(e){ toast(e.message||"Não foi possível enviar. Contate a gestão."); }
  });
}
function cadastrarUnidade(){
  sheet(`<h2>Cadastrar unidade</h2>
    <label>Bloco / Torre (opcional)</label><input id="uBloco" class="field" placeholder="Torre A">
    <label>Número</label><input id="uNum" class="field" placeholder="101">
    <button class="btn" id="uSave">Cadastrar</button>`);
  $("#uSave").addEventListener("click",async()=>{
    const n=$("#uNum").value.trim(); if(!n) return toast("Informe o número.");
    try{ await rpc("unid_criar",{p_cond:S.condId,p_numero:n,p_bloco:$("#uBloco").value.trim()||null}); closeSheet(); toast("Unidade cadastrada 🏠"); }catch(e){ toast(e.message); }
  });
}

// ---------- empty helper ----------
function emptyBox(icon,title,sub){ return `<div class="empty"><div class="big">${icon}</div><b>${esc(title)}</b><p>${esc(sub||"")}</p></div>`; }

// ===================================================================
// ALTURA REAL DA VIEWPORT (corrige o menu/login "fora do lugar" na entrada)
// Alguns navegadores móveis calculam 100vh/100dvh com a barra do navegador na
// 1ª pintura, deixando um vão embaixo até um reflow. Fixamos --vh no innerHeight
// real e reaplicamos em resize/rotação/mudança de viewport.
// ===================================================================
function setVH(){
  // Usa innerHeight (altura estável do layout, igual ao script inline dos HTMLs).
  // NÃO usar visualViewport.height: ele encolhe/oscila quando a barra do Safari
  // aparece no iOS, o que deixava a altura do corpo pulando e abria o "vão"
  // (barra vazia) embaixo no login. O piso min-height:100dvh (app.css) garante
  // que o corpo sempre alcance o fundo real da tela.
  const h = window.innerHeight;
  document.documentElement.style.setProperty("--vh", (h*0.01)+"px");
  document.documentElement.style.setProperty("--appvh", h+"px");
}
setVH();
addEventListener("resize", setVH, {passive:true});
addEventListener("orientationchange", ()=>{ setVH(); setTimeout(setVH,300); });
addEventListener("pageshow", setVH);
// reafirma a altura logo após entrar/trocar de tela (nudge de reflow)
const _showScreen = showScreen;
// eslint-disable-next-line no-func-assign
showScreen = function(id){ _showScreen(id); requestAnimationFrame(setVH); };

// ===================================================================
// INIT
// ===================================================================
renderAuthMode();
if(CONFIGURED){
  // Se a página abriu por um link de recuperação de senha, aguardamos o
  // evento PASSWORD_RECOVERY (mostra a tela de nova senha) em vez de entrar no app.
  if(!/[#&]type=recovery/.test(location.hash)) boot().catch(e=>console.error(e));
}
else { authErr("⚠️ Configure SUPABASE_URL e SUPABASE_ANON no topo do arquivo para começar."); }

// ---------- PWA: service worker + instalar ----------
if("serviceWorker" in navigator){ window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{})); }
let deferredPrompt=null;
const isStandalone=()=> window.matchMedia("(display-mode: standalone)").matches || navigator.standalone===true;
function installBarDismissed(){ try{ return localStorage.getItem("vz-install-dismiss")==="1"; }catch(_){ return false; } }
function maybeShowInstallBar(){
  const bar=$("#installBar"); if(!bar) return;
  const show = !!deferredPrompt && !isStandalone() && !installBarDismissed() && !$("#app").classList.contains("hide");
  bar.classList.toggle("hide", !show);
}
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); deferredPrompt=e; maybeShowInstallBar(); });
window.addEventListener("appinstalled",()=>{ deferredPrompt=null; $("#installBar")?.classList.add("hide"); });
async function promptInstall(){
  if(deferredPrompt){ deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $("#installBar")?.classList.add("hide"); return; }
  toast('Abra o menu do navegador e escolha "Instalar app" / "Adicionar à tela inicial".');
}
$("#installYes")?.addEventListener("click",promptInstall);
$("#installNo")?.addEventListener("click",()=>{ try{ localStorage.setItem("vz-install-dismiss","1"); }catch(_){} $("#installBar")?.classList.add("hide"); });

// ---------- Indicador de offline ----------
function refreshOnline(){
  const off=!navigator.onLine;
  $("#offlineChip")?.classList.toggle("hide",!off);
}
window.addEventListener("online",refreshOnline);
window.addEventListener("offline",()=>{ refreshOnline(); toast("Você está offline. Mostrando dados já carregados."); });
refreshOnline();

// ---------- Web Push (Fase 3) ----------
const pushSuportado=()=> "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
// urlBase64ToUint8Array, abToB64u: em ./helpers.js
// assina (ou re-assina) sempre com a chave VAPID ATUAL. Se a assinatura existente
// foi feita com outra chave (ex.: chave rotacionada), descarta e refaz — assim o
// push volta a funcionar sem o usuário fazer nada.
async function assinarPushAtual(reg){
  let sub=await reg.pushManager.getSubscription();
  if(sub){
    let atual=null; try{ atual=sub.options?.applicationServerKey?abToB64u(sub.options.applicationServerKey):null; }catch(_){}
    if(atual && atual!==VAPID_PUBLIC){ try{ await sub.unsubscribe(); }catch(_){} sub=null; }
  }
  if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC)});
  const j=sub.toJSON();
  await rpc("push_subscribe",{p_endpoint:sub.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth,p_ua:navigator.userAgent});
  return sub;
}
async function ativarPush(){
  if(!pushSuportado()){ toast("Este navegador não suporta notificações push."); return; }
  try{
    const perm=await Notification.requestPermission();
    if(perm!=="granted"){ toast("Permissão de notificação negada."); return; }
    const reg=await navigator.serviceWorker.ready;
    await assinarPushAtual(reg);
    toast("Notificações no aparelho ativadas 🔔");
  }catch(e){ toast(e.message||"Falha ao ativar push."); }
}
// Auto-cura: ao entrar, se a permissão já foi concedida, garante que a assinatura
// usa a chave VAPID atual (conserta sozinho quem assinou com a chave antiga).
async function ensurePush(){
  try{
    if(!pushSuportado() || Notification.permission!=="granted") return;
    const reg=await navigator.serviceWorker.ready;
    await assinarPushAtual(reg);
  }catch(_){}
}
// Convida o morador a ligar os avisos no aparelho (1x) — sem isso o interfone
// não chega com o celular bloqueado. Só quando ainda não decidiu a permissão.
async function talvezPedirPush(){
  try{
    if(!S.unidadeId || !pushSuportado()) return;
    if(Notification.permission!=="default") return;          // já concedeu ou negou
    if(localStorage.getItem("vz-push-ask")==="1") return;     // já perguntou
    localStorage.setItem("vz-push-ask","1");
    if(await confirmar("Receber o interfone no celular mesmo com o app fechado? Ative as notificações.","Ativar avisos")){
      await ativarPush();
    }
  }catch(_){}
}
// SW pede pra navegar quando o usuário toca numa notificação push
navigator.serviceWorker?.addEventListener?.("message",e=>{
  if(e.data?.type==="notif-open" && e.data.link){ const h=(e.data.link||"").replace("#",""); if(h) go(h); }
});

// hook de teste
if(window.__TEST__){ window.__app={tabsFor,fmtDate,esc,isGestor,isPortaria,isSindico,unitLabel,OC_CAT,OC_STATUS,ROLE_LABEL,VINCULO_LABEL}; }
