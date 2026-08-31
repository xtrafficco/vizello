// =============================================================================
// Vizello — helpers puros (sem dependência de DOM, estado ou Supabase).
// Extraído de app.js para permitir teste isolado das funções puras.
// Testável isoladamente: tests/helpers.test.js
// =============================================================================

// ---- papéis / vínculos ----
export const ROLE_APPS = {
  morador:["morador"],
  conselho:["sindico"],
  sindico:["sindico","portaria"],
  super_admin:["sindico","portaria","morador"],
  portaria:["portaria"],
};
export function appsFor(ms){ const s=new Set(); (ms||[]).forEach(m=>(ROLE_APPS[m.role]||[]).forEach(a=>s.add(a))); return [...s]; }
export function membershipsForApp(ms, app){ return (ms||[]).filter(m=>(ROLE_APPS[m.role]||[]).includes(app)); }

export const ROLE_LABEL = { super_admin:"Admin", sindico:"Síndico", conselho:"Conselho", portaria:"Portaria", morador:"Morador" };
export const VINCULO_LABEL = { proprietario:"Proprietário", inquilino:"Inquilino", dependente:"Dependente" };
export const isGestor = r => r==="super_admin" || r==="sindico" || r==="conselho";
export const isPortaria = r => r==="portaria" || r==="super_admin" || r==="sindico";
export const isSindico = r => r==="super_admin" || r==="sindico";

// ---- navegação ----
export const NAV_SVG = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="23" height="23">${p}</svg>`;
export function tabsFor(role){
  const t = [
    {id:"inicio",ic:NAV_SVG('<path d="M4 10v4h3l7 4V6L7 10H4z"/><path d="M18 9a4 4 0 0 1 0 6"/>'),label:"Avisos"},
    {id:"ocorrencias",ic:NAV_SVG('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6h-2.1v-2.1l2.7-2.5z"/>'),label:"Ocorrências"}
  ];
  const box = NAV_SVG('<path d="M12 3 3 7.5V16.5L12 21l9-4.5V7.5L12 3z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>');
  if(isPortaria(role)) t.push({id:"portaria",ic:box,label:"Portaria"});
  else t.push({id:"encomendas",ic:box,label:"Encomendas"});
  t.push({id:"servicos",ic:NAV_SVG('<rect x="4" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4"/>'),label:"Serviços"});
  t.push({id:"perfil",ic:NAV_SVG('<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>'),label:"Perfil"});
  return t;
}

// ---- formatação ----
export function fmtDate(iso){
  if(!iso) return "";
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString()===now.toDateString();
  const opt = sameDay ? {hour:"2-digit",minute:"2-digit"} : {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"};
  return d.toLocaleString("pt-BR",opt);
}
export function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
export function fmtNum(n){ return (n==null||n==="")?"—":Number(n).toLocaleString("pt-BR",{maximumFractionDigits:3}); }
export function compLabel(c){ if(!c||!/^\d{4}-\d{2}$/.test(c)) return c||""; const [y,m]=c.split("-"); return m+"/"+y.slice(2); }
export function fmtBytes(b){ if(!b) return ""; const u=["B","KB","MB","GB"]; let i=0,n=Number(b); while(n>=1024&&i<u.length-1){n/=1024;i++;} return `${n.toFixed(n<10&&i>0?1:0)} ${u[i]}`; }
// Formatação de moeda unificada (pt-BR / BRL, com separador de milhar). Antes
// havia deriva: esta versão gerava "R$ 1234,56" enquanto admin/imobiliária
// usavam toLocaleString ("R$ 1.234,56"). Agora todos os portais usam esta.
export const fmtMoney = v => (Number(v)||0).toLocaleString("pt-BR", {style:"currency", currency:"BRL"}).replace(/[\u00a0\u202f]/g, " ");
export const unitLabel = (bloco,numero)=> numero ? `${bloco?bloco+" ":""}${numero}` : "Sem unidade";
// Normaliza um telefone para o formato do link wa.me (só dígitos, prefixo 55
// quando parece um número nacional sem DDI). Compartilhado por app.js e
// imobiliaria-app.js — antes duplicado idêntico em ambos.
export function waPhone(raw){ let d=(raw||"").replace(/\D/g,""); if(!d) return ""; if(d.length<=11 && !d.startsWith("55")) d="55"+d; return d; }

// Mensagens de banco/infraestrutura não devem ser expostas diretamente na UI.
// O detalhe técnico continua disponível no console/observabilidade do app.
export function publicErrorMessage(error, fallback="Não foi possível concluir a ação."){
  const text=String(error?.message??error??"").trim();
  if(!text || text.length>220 || /(postgres|postgrest|supabase|permission denied|violates|relation |column |function |sqlstate|pgrst|jwt|duplicate key|foreign key)/i.test(text)) return fallback;
  return text;
}

// Dados recebidos do backend nunca devem controlar a navegação do app.
// Notificações são permitidas somente para abas conhecidas, sem URL externa,
// query string ou código executável.
export const APP_TABS = Object.freeze([
  "inicio", "ocorrencias", "portaria", "encomendas", "servicos", "reservas",
  "financeiro", "assembleias", "enquetes", "manutencoes", "mural", "livro",
  "documentos", "gestao", "atendimento", "contas", "perfil", "cadastros",
  "vagas", "autorizacoes", "conversas", "pesquisas", "consumo", "painel", "sos"
]);
export function safeAppTab(value){
  const raw=String(value??"").trim().replace(/^#/,"");
  return APP_TABS.includes(raw) ? raw : null;
}

// Defesa em profundidade para uploads: a policy/RPC do servidor continua
// sendo a autoridade final, mas o cliente rejeita arquivos obviamente abusivos.
export const ALLOWED_UPLOAD_MIME = Object.freeze([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  "text/plain", "application/zip"
]);
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export function validateUpload(file, {maxBytes=MAX_UPLOAD_BYTES, mime=ALLOWED_UPLOAD_MIME}={}){
  if(!file || typeof file.name!=="string") return {ok:false, message:"Arquivo inválido."};
  if(!Number.isFinite(file.size) || file.size<=0 || file.size>maxBytes) return {ok:false, message:"O arquivo excede o limite permitido."};
  if(file.type && !mime.includes(file.type.toLowerCase())) return {ok:false, message:"Tipo de arquivo não permitido."};
  return {ok:true};
}

// ---- rótulos de domínio ----
export const OC_CAT = {manutencao:"Manutenção",limpeza:"Limpeza",seguranca:"Segurança",barulho:"Barulho",area_comum:"Área comum",outro:"Outro"};
export const OC_STATUS = {aberta:"Aberta",em_andamento:"Em andamento",resolvida:"Resolvida",cancelada:"Cancelada"};

// ---- Web Push (conversões de chave) ----
export function urlBase64ToUint8Array(b){
  const pad="=".repeat((4-b.length%4)%4), b64=(b+pad).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(b64), arr=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
  return arr;
}
export function abToB64u(buf){
  const b=new Uint8Array(buf); let s=""; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
