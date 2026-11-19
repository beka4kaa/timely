// Ответ тьютора для чтения вслух: без разметки и с формулами словами.
//
// Синтез речи читает текст как есть: «звёздочка звёздочка», «доллар», «бэкслеш фрак».
// Здесь разметка снимается, пункты списка и заголовки становятся отдельными фразами,
// а простые формулы — словами. Блоки кода не зачитываются построчно.

function spokenMath(tex: string): string {
  let text = tex.trim();
  // Вложенные дроби разворачиваются изнутри наружу.
  for (let pass = 0; pass < 3; pass += 1) text = text.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1 делить на $2");
  text = text
    .replace(/\\sqrt\{([^{}]*)\}/g, "корень из $1")
    .replace(/\^\{([^{}]*)\}/g, " в степени $1")
    .replace(/\^(\w)/g, " в степени $1")
    .replace(/_\{([^{}]*)\}/g, " $1")
    .replace(/_(\w)/g, " $1")
    .replace(/\\(cdot|times)\b/g, " умножить на ")
    .replace(/\\(leq?)\b/g, " меньше или равно ")
    .replace(/\\(geq?)\b/g, " больше или равно ")
    .replace(/\\neq?\b/g, " не равно ")
    .replace(/\\pi\b/g, " пи ")
    .replace(/\\infty\b/g, " бесконечность ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}]/g, "");
  return text.replace(/\s{2,}/g, " ").trim();
}

export function speakableText(markdown: string): string {
  let text = markdown.replace(/\r\n/g, "\n");
  text = text.replace(/```[\s\S]*?```/g, "Пример кода пропускаю.");
  text = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => spokenMath(tex))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => spokenMath(tex))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => spokenMath(tex))
    .replace(/\$([^$\n]+?)\$/g, (_, tex: string) => spokenMath(tex));
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)([^*_\n]+?)\1/g, "$2");

  const lines = text
    .split("\n")
    .map((raw) => {
      let line = raw.trim().replace(/^>\s?/, "");
      const heading = /^#{1,6}\s+/.test(line);
      const item = /^([-*+]|\d+[.)])\s+/.test(line);
      line = line.replace(/^#{1,6}\s+/, "").replace(/^([-*+]|\d+[.)])\s+/, "");
      // Заголовок и пункт — отдельная фраза: без точки голос слил бы их со следующей строкой.
      if ((heading || item) && line && !/[.!?:;…]$/.test(line)) line += ".";
      return line;
    })
    .filter(Boolean);
  return lines.join("\n").replace(/[ \t]{2,}/g, " ").trim();
}
