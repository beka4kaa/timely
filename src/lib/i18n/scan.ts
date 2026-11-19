// Разбор исходников для проверки переводов. Только для тестов и `npm run i18n:todo`,
// в сборку приложения не попадает.
//
// Ищет вызовы `t("…")`, `msg("…")` и `plural(n, "…", "…", "…")` (их ключи должны быть в словаре) и
// русский текст, который ещё не обёрнут в перевод. Разбирает настоящим парсером TypeScript,
// поэтому комментарии и регулярные выражения не мешают.

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

export interface FoundKey {
  file: string;
  line: number;
  key: string;
  kind: "t" | "msg" | "plural";
}

export interface FoundText {
  file: string;
  line: number;
  text: string;
}

export interface ScanResult {
  keys: FoundKey[];
  /** Вызовы, которые нельзя перевести: шаблон с `${}` вместо `{имени}`. */
  broken: FoundText[];
  /** Русский текст вне `t()` и `plural()`. */
  leftovers: FoundText[];
}

const CYRILLIC = /[А-Яа-яЁё]/;

/** Строка с этой пометкой (или строка над ней) намеренно остаётся русской: данные, а не интерфейс. */
const SKIP_MARK = "i18n-skip";

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function isConsoleCall(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent)) {
      const callee = parent.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "console"
      ) {
        return true;
      }
    }
    if (ts.isFunctionLike(parent) || ts.isSourceFile(parent)) return false;
  }
  return false;
}

export function scanSource(file: string, source: string): ScanResult {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const lines = source.split("\n");
  const result: ScanResult = { keys: [], broken: [], leftovers: [] };
  const translated = new Set<ts.Node>();

  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const skipped = (line: number) =>
    (lines[line - 1] ?? "").includes(SKIP_MARK) || (lines[line - 2] ?? "").includes(SKIP_MARK);

  const leftover = (node: ts.Node, text: string) => {
    const line = lineOf(node);
    if (!CYRILLIC.test(text) || skipped(line) || isConsoleCall(node)) return;
    result.leftovers.push({ file, line, text: text.trim().replace(/\s+/g, " ") });
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name === "t" || name === "msg") {
        const [first, , third] = node.arguments;
        const text = literalText(first);
        const context = name === "t" ? literalText(third) : null;
        if (text !== null) {
          const key = context ? `${context}::${text}` : text;
          result.keys.push({ file, line: lineOf(node), key, kind: name === "msg" ? "msg" : "t" });
          translated.add(first);
        } else if (first && ts.isTemplateExpression(first)) {
          result.broken.push({ file, line: lineOf(node), text: first.getText(sf) });
          translated.add(first);
        }
      } else if (name === "plural") {
        const args = node.arguments;
        let forms: readonly ts.Node[] = [];
        if (args.length === 4) forms = args.slice(1);
        else if (args.length === 2 && ts.isArrayLiteralExpression(args[1])) forms = args[1].elements;
        const texts = forms.map(literalText);
        if (forms.length === 3 && texts.every((text): text is string => text !== null)) {
          result.keys.push({ file, line: lineOf(node), key: texts.join("|"), kind: "plural" });
          forms.forEach((form) => translated.add(form));
        }
      }
    }

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !translated.has(node)) {
      const parent = node.parent;
      const isModulePath =
        parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent));
      if (!isModulePath) leftover(node, node.text);
    } else if (ts.isTemplateExpression(node) && !translated.has(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      if (parts.some((part) => CYRILLIC.test(part))) leftover(node, node.getText(sf));
    } else if (ts.isJsxText(node)) {
      leftover(node, node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return result;
}

/** Исходники приложения: .ts и .tsx без тестов и самих словарей. */
export function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || full.endsWith(path.join("i18n", "en"))) continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  if (fs.statSync(root).isDirectory()) walk(root);
  else out.push(root);
  return out.sort();
}

export function scanFiles(files: string[], base: string): ScanResult {
  const total: ScanResult = { keys: [], broken: [], leftovers: [] };
  for (const file of files) {
    const found = scanSource(path.relative(base, file), fs.readFileSync(file, "utf8"));
    total.keys.push(...found.keys);
    total.broken.push(...found.broken);
    total.leftovers.push(...found.leftovers);
  }
  return total;
}

/** Имена подстановок `{имя}` в строке. */
export function placeholders(text: string): string[] {
  const names = Array.from(text.matchAll(/\{(\w+)\}/g), (match) => match[1]);
  return Array.from(new Set(names)).sort();
}
