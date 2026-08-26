// Fonte única dos valores públicos exibidos no site.
// O checkout continua validando os preços retornados pelo backend.
export const PLAN_PRICES = Object.freeze({
  essencial: Object.freeze({ monthly: 4.90, annual: 4.41, minimum: 149 }),
  pro: Object.freeze({ monthly: 7.90, annual: 7.11, minimum: 299 }),
});

export function planBRL(value) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
}
