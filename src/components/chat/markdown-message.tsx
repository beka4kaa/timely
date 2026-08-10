"use client";

// Ответ модели с нормальной типографикой.
//
// До этого текст выводился как есть, и ученик читал `**«Hands-On Machine
// Learning»**` со звёздочками. Для книг по физике и ML это ещё и формулы:
// без KaTeX они приезжают долларами.
//
// Стили KaTeX подключает тот, кто рендерит: так же сделано в
// `AITutorBoard.tsx` и `IllustrationRenderer.tsx`. Здесь их нет ещё и затем,
// чтобы компонент можно было прогнать в тесте без DOM и без сборщика.
//
// БЕЗОПАСНОСТЬ. `rehype-raw` здесь не подключён и подключён быть не может: это
// единственное, что позволило бы ответу модели стать исполняемым HTML
// (`CLAUDE.md` §17.4). `react-markdown` строит React-элементы, а не
// `innerHTML`, поэтому `<script>` из ответа остаётся текстом.

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

// Шкала под узкую панель: 280–400 px. Заголовок в 20 px здесь занял бы треть
// ширины, поэтому крупных размеров нет вовсе — разница держится на весе.
const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,

  h1: ({ children }) => (
    <h3 className="mb-1.5 mt-3 font-serif text-[14px] font-semibold text-[#37322c] first:mt-0">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h4 className="mb-1.5 mt-3 font-serif text-[13.5px] font-semibold text-[#37322c] first:mt-0">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="mb-1 mt-2.5 text-[13px] font-semibold text-[#4a433b] first:mt-0">
      {children}
    </h5>
  ),
  h4: ({ children }) => (
    <h6 className="mb-1 mt-2.5 text-[12.5px] font-semibold text-[#4a433b] first:mt-0">
      {children}
    </h6>
  ),

  strong: ({ children }) => (
    <strong className="font-semibold text-[#37322c]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,

  ul: ({ children }) => (
    <ul className="mb-2 space-y-1 pl-4 last:mb-0 [&>li]:list-disc">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 space-y-1 pl-4 last:mb-0 [&>li]:list-decimal">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="marker:text-[#b98343] [&>p]:mb-0">{children}</li>
  ),

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      // noreferrer обязателен: ссылка приходит из ответа модели, и открытая
      // вкладка не должна получить доступ к `window.opener`.
      rel="noopener noreferrer"
      className="underline decoration-[#c9a16c] underline-offset-2 hover:text-[#6f481c]"
    >
      {children}
    </a>
  ),

  code: ({ className, children }) => {
    // У блока кода react-markdown ставит `language-*`; инлайн приходит без него.
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <code className="font-mono text-[12px] leading-[1.5]">{children}</code>
      );
    }
    return (
      <code className="rounded-[5px] bg-[#efece5] px-1 py-[1px] font-mono text-[12px] text-[#4a433b]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-[10px] border border-[#e4e0d8] bg-[#f2efe8] p-2.5 last:mb-0">
      {children}
    </pre>
  ),

  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-[#dcd5c8] pl-2.5 italic text-[#6d665d] last:mb-0">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="my-3 border-[#e4e0d8]" />,

  // Таблица прокручивается в своём контейнере: панель узкая, и без этого
  // широкая таблица растянула бы всю ленту сообщений.
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[#e4e0d8] bg-[#f4f1ea] px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[#e4e0d8] px-2 py-1 align-top">{children}</td>
  ),
};

const PLUGINS_REMARK = [remarkGfm, remarkBreaks, remarkMath];
const PLUGINS_REHYPE = [rehypeKatex];

export function MarkdownMessage({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={`chat-markdown ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={PLUGINS_REMARK}
        rehypePlugins={PLUGINS_REHYPE}
        components={COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
