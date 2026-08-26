import test from "node:test";
import assert from "node:assert/strict";
import {
  esc,
  fmtMoney,
  unitLabel,
  tabsFor,
  appsFor,
  membershipsForApp,
  isGestor,
  publicErrorMessage,
  safeAppTab,
  validateUpload
} from "../helpers.js";

test("esc protege texto usado em HTML", () => {
  assert.equal(esc("<script>alert('x')</script>"), "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
});

test("formatadores preservam o contrato pt-BR", () => {
  assert.equal(fmtMoney(12.5), "R$ 12,50");
  assert.equal(unitLabel("A", "302"), "A 302");
  assert.equal(unitLabel("", ""), "Sem unidade");
});

test("papéis e navegação permanecem consistentes", () => {
  const memberships = [
    { role: "morador" },
    { role: "sindico" },
    { role: "portaria" }
  ];
  assert.deepEqual(appsFor(memberships).sort(), ["morador", "portaria", "sindico"]);
  assert.equal(membershipsForApp(memberships, "sindico").length, 1);
  assert.equal(isGestor("sindico"), true);
  assert.equal(tabsFor("morador").at(-1).id, "perfil");
});

test("mensagens técnicas não vazam para a interface", () => {
  assert.equal(publicErrorMessage({ message: "violates row-level security policy" }), "Não foi possível concluir a ação.");
  assert.equal(publicErrorMessage({ message: "Informe o nome." }), "Informe o nome.");
});

test("navegação de notificações é limitada às abas internas", () => {
  assert.equal(safeAppTab("#financeiro"), "financeiro");
  assert.equal(safeAppTab("https://evil.example"), null);
  assert.equal(safeAppTab("#javascript:alert(1)"), null);
});

test("uploads rejeitam arquivos excessivos ou tipos inesperados", () => {
  assert.equal(validateUpload({name:"foto.png",size:100,type:"image/png"}).ok, true);
  assert.equal(validateUpload({name:"script.js",size:100,type:"application/javascript"}).ok, false);
  assert.equal(validateUpload({name:"grande.pdf",size:16*1024*1024,type:"application/pdf"}).ok, false);
});
