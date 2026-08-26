import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const ignored = new Set(["node_modules", ".git", ".codex"]);
const extensions = new Set([".js", ".mjs", ".ts", ".html", ".json", ".toml", ".yml", ".yaml"]);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
}

walk(root);
const findings = [];
const warnings = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  const normalizedRelative = relative.replaceAll("\\", "/");
  const isServerFunction = normalizedRelative.includes("supabase/functions/");
  if (!isServerFunction && /(?:service[_-]?role|sb_secret_)[A-Za-z0-9_-]*\s*[:=]\s*[A-Za-z0-9._-]{12,}/i.test(text)) {
    findings.push(relative + ": possível chave Supabase privilegiada no cliente");
  }
  if (/<(?:button|a|input|select|form|div)[^>]+\son[a-z]+\s*=/i.test(text)) {
    findings.push(relative + ": handler inline incompatível com script-src-attr 'none'");
  }
  const broadSelects = (text.match(/\.select\(["']\*["']\)/g) || []).length;
  if (broadSelects) warnings.push(relative + ": " + broadSelects + " consulta(s) select(\"*\")");
  if (/(?:href|src)\s*=\s*["']https?:\/\/(?:esm\.sh|unpkg\.com)/i.test(text)) {
    warnings.push(relative + ": dependência CDN sem SRI");
  }
}

if (findings.length) {
  console.error("Security checks failed:");
  for (const finding of findings) console.error("- " + finding);
  process.exitCode = 1;
} else {
  console.log("Security checks passed (" + files.length + " arquivos analisados).");
}
if (warnings.length) {
  console.warn("Security hardening backlog:");
  for (const warning of warnings.slice(0, 40)) console.warn("- " + warning);
  if (warnings.length > 40) console.warn("- ... e mais " + (warnings.length - 40) + " aviso(s)");
}
