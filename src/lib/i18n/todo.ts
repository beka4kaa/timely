// Что осталось перевести: `npm run i18n:todo -- src/components/chat src/lib/now-feed.ts`.
// Без путей проверяет весь src. Показывает русский текст вне `t()`, ключи без перевода и
// шаблоны с `${}` внутри `t()`. Строку с пометкой `i18n-skip` (или под ней) пропускает.

import * as path from "node:path";

import EN from "./en/index";
import { scanFiles, sourceFiles, type FoundText } from "./scan";

const ROOT = path.resolve(__dirname, "../../..");
const targets = process.argv.slice(2);
const files = (targets.length ? targets : ["src"]).flatMap((target) => sourceFiles(path.resolve(ROOT, target)));
const found = scanFiles(files, ROOT);

function byFile(items: FoundText[]) {
  const groups = new Map<string, FoundText[]>();
  for (const item of items) groups.set(item.file, [...(groups.get(item.file) ?? []), item]);
  return groups;
}

const missing = found.keys.filter((key) => !EN[key.key]);

for (const [file, items] of Array.from(byFile(found.leftovers))) {
  console.log(`\n${file} (${items.length})`);
  for (const item of items) console.log(`  ${item.line}: ${item.text.slice(0, 110)}`);
}
if (missing.length) {
  console.log("\nНет перевода в словаре:");
  for (const key of missing) console.log(`  ${key.file}:${key.line} ${JSON.stringify(key.key)}`);
}
if (found.broken.length) {
  console.log("\nШаблон с ${} внутри t():");
  for (const item of found.broken) console.log(`  ${item.file}:${item.line} ${item.text.slice(0, 110)}`);
}
console.log(
  `\nИтого: ${found.leftovers.length} строк без перевода в ${byFile(found.leftovers).size} файлах, ` +
    `${missing.length} ключей без английского, ${found.broken.length} шаблонов.`,
);
