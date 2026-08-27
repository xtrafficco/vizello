import { supabase as sb, redirectToLogin } from "./supabase-client.js";
const qs=new URLSearchParams(location.search), tipo=qs.get("tipo")==="imobiliaria"?"imobiliaria":"condominio", tenant=qs.get("tenant")||qs.get("cond")||"";
const state={plans:[],selected:qs.get("plano")==="pro"?"pro":"essencial",subscription:null,ready:false};
const $=s=>document.querySelector(s), statusEl=$("#status");
function showStatus(text,kind="info"){statusEl.textContent=text;statusEl.className="status show "+kind;statusEl.setAttribute("role",kind==="error"?"alert":"status");}
function money(v){return Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
function renderPlans(){
  $("#plans").innerHTML=state.plans.map(p=>`<button type="button" class="plan ${state.selected===p.slug?"selected":""}" data-plan="${esc(p.slug)}"><span class="plan-name">${esc(p.nome)}</span>${p.slug==="pro"?'<span class="plan-badge">Mais escolhido</span>':""}<span class="plan-price">${money(p.valor_mensal)} <small>/unidade/mês</small></span><span class="plan-desc">${esc(p.descricao||"Plano Vizello")}</span></button>`).join("");
  $("#plans").querySelectorAll("[data-plan]").forEach(b=>b.onclick=()=>{state.selected=b.dataset.plan;renderPlans();renderEstimate();});
}
function renderEstimate(){
  const p=state.plans.find(x=>x.slug===state.selected)||state.plans[0], s=state.subscription||{};
  if(!p){ $("#amount").textContent="—"; $("#amountHint").textContent="Preço indisponível."; return; }
  const units=Number(s.unidades||0), total=Math.max(units*Number(p.valor_mensal||0),Number(p.minimo_mensal||0));
  $("#amount").textContent=total?money(total):money(p.minimo_mensal);
  $("#amountHint").textContent=units?`${units} unidade(s)/imóvel(is) · mínimo mensal de ${money(p.minimo_mensal)}`:`mínimo mensal de ${money(p.minimo_mensal)}`;
}
function showResult(kind){
  $("#checkoutPanel").style.display="none";$("#result").classList.add("show");
  if(kind==="failure"){ $("#resultTitle").textContent="Pagamento não concluído";$("#resultText").textContent="O pagamento não foi aprovado. Você pode tentar novamente escolhendo Pix ou cartão.";$("#result").querySelector("a").href=location.href.split("&status=")[0]; }
  if(kind==="pending"){ $("#resultTitle").textContent="Pagamento pendente";$("#resultText").textContent="O Mercado Pago ainda está processando o pagamento. Assim que confirmar, seu acesso será liberado automaticamente."; }
}
async function boot(){
  const {data:{user}}=await sb.auth.getUser();
  if(!user){redirectToLogin();return;}
  if(!tenant){showStatus("Não encontramos o condomínio ou a imobiliária para esta assinatura.","error");return;}
  const resultStatus=qs.get("status"); if(resultStatus) showResult(resultStatus);
  try{
    const {data,error}=await sb.rpc("planos_publicos");
    if(error||!Array.isArray(data)||!data.length) throw error||new Error("planos indisponíveis");
    state.plans=data;
  }catch(_){
    showStatus("Não foi possível carregar os planos atuais. Tente novamente em instantes.","error");
    return;
  }
  try{
    const fn=tipo==="imobiliaria"?"minha_assinatura_imob":"minha_assinatura_vizello";
    const {data,error}=await sb.rpc(fn,tipo==="imobiliaria"?{p_imob:tenant}:{p_cond:tenant});if(error)throw error;state.subscription=data;
    $("#tenantText").textContent=`${data.plano_nome||"Plano Vizello"} · ${data.dias_restantes?data.dias_restantes+" dia(s) restantes no trial":"assinatura a ativar"}`;
    if(data.plano_slug&&state.plans.some(p=>p.slug===data.plano_slug))state.selected=data.plano_slug;
  }catch(_){
    showStatus("Não foi possível confirmar os dados da assinatura. Atualize a página e tente novamente.","error");
    return;
  }
  renderPlans();renderEstimate(); state.ready=true; $("#payBtn").disabled=false;
}
$("#payBtn").onclick=async()=>{
  $("#payBtn").disabled=true;$("#payBtn").textContent="Preparando checkout…";showStatus("Abrindo o pagamento seguro…");
  try{const {data,error}=await sb.functions.invoke("criar-checkout-assinatura",{body:{tipo,tenant_id:tenant,plano:state.selected}});if(error||!data?.init_point)throw new Error(data?.error||error?.message||"Não foi possível iniciar o pagamento.");location.href=data.init_point;}
  catch(e){console.error(e);showStatus("Não foi possível iniciar o pagamento. Tente novamente.","error");$("#payBtn").disabled=false;$("#payBtn").textContent="Continuar para Pix ou cartão →";}
};
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
boot();
