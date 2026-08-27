import { PLAN_PRICES, planBRL } from "./plans.js";

(function(){
  document.querySelectorAll(".amount[data-plan]").forEach(function(el){
    var plan=PLAN_PRICES[el.dataset.plan];
    if(plan) el.dataset.m=planBRL(plan.monthly)+"<small>/unidade/mês</small>";
    if(plan) el.dataset.a=planBRL(plan.annual)+"<small>/unidade/mês</small>";
  });
  document.querySelectorAll(".pmin[data-plan]").forEach(function(el){
    var plan=PLAN_PRICES[el.dataset.plan];
    if(plan) el.textContent="Mínimo mensal de "+planBRL(plan.minimum)+" · "+(el.dataset.plan==="essencial"?"inclui até 30 unidades":"cobrança por unidade ativa");
  });
})();

(function(){
  var els=[].slice.call(document.querySelectorAll('.reveal'));
  if(!('IntersectionObserver' in window)||window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    els.forEach(function(e){e.classList.add('in');}); return;
  }
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
  },{rootMargin:'0px 0px -8% 0px',threshold:.08});
  els.forEach(function(e){io.observe(e);});
})();

// Demo do app: alterna as telas do telefone
(function(){
  var scrs=[].slice.call(document.querySelectorAll('.scr'));
  var dots=[].slice.call(document.querySelectorAll('.phone-dots span'));
  if(!scrs.length) return;
  scrs[0].classList.add('on'); if(dots[0]) dots[0].classList.add('on');
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var i=0;
  setInterval(function(){
    scrs[i].classList.remove('on'); if(dots[i]) dots[i].classList.remove('on');
    i=(i+1)%scrs.length;
    scrs[i].classList.add('on'); if(dots[i]) dots[i].classList.add('on');
  },2900);
})();

// Preços: alterna mensal/anual
(function(){
  var btns=[].slice.call(document.querySelectorAll('.billtoggle button'));
  if(!btns.length) return;
  function set(mode){
    btns.forEach(function(b){ var on=b.dataset.bill===mode; b.classList.toggle('on',on); b.setAttribute('aria-pressed',on); });
    document.querySelectorAll('.amount[data-m]').forEach(function(el){ el.innerHTML = (mode==='anual'? el.dataset.a : el.dataset.m); });
    document.querySelectorAll('.bill-note').forEach(function(n){ n.style.display = (mode==='anual'? 'block':'none'); });
  }
  btns.forEach(function(b){ b.addEventListener('click',function(){ set(b.dataset.bill); }); });
  set('mensal');
})();

// Scroll-spy: destaca o link do menu da seção visível
(function(){
  var links=[].slice.call(document.querySelectorAll('.nav .links a[href^="#"]'));
  if(!links.length||!('IntersectionObserver' in window)) return;
  var map={}; links.forEach(function(a){ map[a.getAttribute('href').slice(1)]=a; });
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ links.forEach(function(l){l.classList.remove('on');}); var a=map[e.target.id]; if(a) a.classList.add('on'); } });
  },{rootMargin:'-45% 0px -50% 0px'});
  ['produto','recursos','precos','faq'].forEach(function(id){ var s=document.getElementById(id); if(s) io.observe(s); });
})();
