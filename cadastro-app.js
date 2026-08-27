import { supabase as sb } from "./supabase-client.js";
import { PLAN_PRICES, planBRL } from "./plans.js";

document.querySelectorAll(".plan-price[data-plan]").forEach((el) => {
  const plan = PLAN_PRICES[el.dataset.plan];
  if (plan) el.innerHTML = `${planBRL(plan.monthly)} <small>/unidade/mês</small>`;
});

const form = document.getElementById("signupForm");
const message = document.getElementById("message");
const submit = document.getElementById("submitBtn");
const formPanel = document.getElementById("formPanel");
const successPanel = document.getElementById("successPanel");
const successText = document.getElementById("successText");

function showMessage(text, type="error") { message.textContent=text; message.className="message show "+type; }
function clearMessage() { message.textContent=""; message.className="message"; }
function cleanPhone(value) { return value.replace(/\D/g, ""); }
function friendlyError(error) {
  const text=String(error?.message||"").toLowerCase();
  if(text.includes("already registered")) return "Este e-mail já possui uma conta. Entre pelo acesso ou use outro e-mail.";
  if(text.includes("password")) return "A senha precisa ter pelo menos 6 caracteres.";
  if(text.includes("rate limit")||text.includes("too many")) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  return "Não foi possível criar sua conta agora. Confira os dados e tente novamente.";
}

const queryPlan = new URLSearchParams(location.search).get("plano");
const initialPlan = queryPlan === "pro" ? "pro" : "essencial";
document.querySelector(`input[name="plan"][value="${initialPlan}"]`).checked = true;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();
  form.querySelectorAll(".invalid").forEach(el=>{el.classList.remove("invalid");el.removeAttribute("aria-invalid");el.removeAttribute("aria-describedby");});
  const data = new FormData(form);
  const name=String(data.get("name")||"").trim();
  const phone=String(data.get("phone")||"").trim();
  const email=String(data.get("email")||"").trim().toLowerCase();
  const role=String(data.get("role")||"");
  const units=String(data.get("units")||"");
  const organization=String(data.get("organization")||"").trim();
  const password=String(data.get("password")||"");
  const password2=String(data.get("password2")||"");
  const plan=String(data.get("plan")||"");
  const problems=[];
  if(name.length<3) problems.push(["name","Informe seu nome completo."]);
  if(cleanPhone(phone).length<10) problems.push(["phone","Informe um WhatsApp válido."]);
  if(!/^\S+@\S+\.\S+$/.test(email)) problems.push(["email","Informe um e-mail válido."]);
  if(!role) problems.push(["role","Selecione seu perfil."]);
  if(!units) problems.push(["units","Informe o tamanho da operação."]);
  if(organization.length<2) problems.push(["organization","Informe o nome do condomínio ou empresa."]);
  if(password.length<6) problems.push(["password","A senha precisa ter pelo menos 6 caracteres."]);
  if(password!==password2) problems.push(["password2","As senhas não conferem."]);
  if(!plan) problems.push(["plan","Escolha um plano inicial."]);
  if(!document.getElementById("terms").checked) problems.push(["terms","Aceite os termos para continuar."]);
  if(problems.length){
     problems.forEach(([id])=>{const el=document.getElementById(id);if(el){el.classList.add("invalid");el.setAttribute("aria-invalid","true");el.setAttribute("aria-describedby","message");}});
    showMessage(problems[0][1]);
    document.getElementById(problems[0][0])?.focus();
    return;
  }
  submit.disabled=true; submit.textContent="Criando sua conta…";
  try{
    const {data:result,error}=await sb.auth.signUp({email,password,options:{data:{nome:name,telefone:phone,perfil:role,organizacao:organization,unidades:units,plano:plan}}});
    if(error) throw error;
    if(result.user){
      try{ await sb.rpc("perfil_salvar",{p_nome:name,p_telefone:phone}); }catch(_){ /* o cadastro continua mesmo se o perfil exigir confirmação */ }
    }
    formPanel.style.display="none";
    successPanel.classList.add("show");
    if(result.session){
      successText.textContent="Sua conta já está pronta. Você será encaminhado para o Vizello em instantes.";
      setTimeout(()=>{ location.href="/condominio"; },1200);
    } else {
      successText.textContent=`Enviamos uma mensagem para ${email} para confirmar seu e-mail. Depois, entre no Vizello para continuar.`;
    }
  }catch(error){
    showMessage(friendlyError(error));
    submit.disabled=false; submit.textContent="Criar minha conta grátis →";
  }
});
