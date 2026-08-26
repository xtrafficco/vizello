// Vizello — utilitários de acessibilidade compartilhados pelo shell do app.
// Mantém a camada de UI reutilizável sem depender de Supabase ou de estado.

export function wireLabels(root = document) {
  root.querySelectorAll("label").forEach((label) => {
    if (label.htmlFor || label.querySelector("input,select,textarea")) return;
    let el = label.nextElementSibling;
    while (el && !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const nested = el.querySelector?.("input,select,textarea");
      if (nested) { el = nested; break; }
      el = el.nextElementSibling;
    }
    if (el?.id) label.htmlFor = el.id;
  });
}

export function syncA11y(root = document) {
  wireLabels(root);
  root.querySelectorAll(".spin").forEach((el) => {
    el.setAttribute("role", "status");
    el.setAttribute("aria-label", "Carregando");
  });
}
