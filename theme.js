// Tema claro/escuro — compartilhado entre o app do condomínio (app.js) e o
// painel admin (admin-app.js). Antes estas três funções eram duplicadas
// byte a byte em ambos os arquivos (ver ARCHITECTURE.md, P1).
// A chave "vz-theme" e o atributo data-theme são os mesmos usados pelo script
// de bootstrap inline no <head>, que aplica o tema antes do primeiro paint.
export function currentTheme(){ return document.documentElement.getAttribute("data-theme")||"light"; }
export function applyTheme(t){ document.documentElement.setAttribute("data-theme",t); try{ localStorage.setItem("vz-theme",t); }catch(_){}; const el=document.querySelector('meta[name=theme-color]'); if(el) el.content=t==="dark"?"#0d1f30":"#183451"; }
export function toggleTheme(){ applyTheme(currentTheme()==="dark"?"light":"dark"); }
