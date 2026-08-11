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

/**
 * Размеры под ширину, в которой читают.
 *
 * `rail` — узкая панель, 280–400 px: заголовок в 20 px занял бы там треть
 * ширины, поэтому крупных размеров нет вовсе и разница держится на весе.
 * `page` — колонка страницы: там та же шкала выглядела бы мелким шрифтом
 * договора, и заголовкам наконец есть куда вырасти.
 *
 * Одна фабрика на оба варианта, а не два списка компонентов: разошедшись, они
 * дали бы разный markdown в панели и на странице для одного и того же ответа.
 */
interface Scale {
  h1: string;
  h2: string;
  h3: string;
  h4: string;
  code: string;
  table: string;
  gap: string;
  headGap: string;
  pad: string;
}

const SCALES: Record<"rail" | "page", Scale> = {
  rail: {
    h1: "text-[14px]",
    h2: "text-[13.5px]",
    h3: "text-[13px]",
    h4: "text-[12.5px]",
    code: "text-[12px]",
    table: "text-[12px]",
    gap: "mb-2",
    headGap: "mt-3",
    pad: "p-2.5",
  },
  page: {
    h1: "text-[19px]",
    h2: "text-[17px]",
    h3: "text-[15.5px]",
    h4: "text-[15px]",
    code: "text-[13.5px]",
    table: "text-[13.5px]",
    gap: "mb-3.5",
    headGap: "mt-6",
    pad: "p-3.5",
  },
};

function buildComponents(s: Scale): Components {
  return {
    p: ({ children }) => <p className={`${s.gap} last:mb-0`}>{children}</p>,

    h1: ({ children }) => (
      <h3
        className={`mb-1.5 ${s.headGap} font-serif ${s.h1} font-semibold text-[#37322c] first:mt-0`}
      >
        {children}
      </h3>
    ),
    h2: ({ children }) => (
      <h4
        className={`mb-1.5 ${s.headGap} font-serif ${s.h2} font-semibold text-[#37322c] first:mt-0`}
      >
        {children}
      </h4>
    ),
    h3: ({ children }) => (
      <h5
        className={`mb-1 mt-2.5 ${s.h3} font-semibold text-[#4a433b] first:mt-0`}
      >
        {children}
      </h5>
    ),
    h4: ({ children }) => (
      <h6
        className={`mb-1 mt-2.5 ${s.h4} font-semibold text-[#4a433b] first:mt-0`}
      >
        {children}
      </h6>
    ),

    strong: ({ children }) => (
      <strong className="font-semibold text-[#37322c]">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,

    ul: ({ children }) => (
      <ul className={`${s.gap} space-y-1 pl-4 last:mb-0 [&>li]:list-disc`}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className={`${s.gap} space-y-1 pl-4 last:mb-0 [&>li]:list-decimal`}>
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
          <code className={`font-mono ${s.code} leading-[1.5]`}>{children}</code>
        );
      }
      return (
        <code
          className={`rounded-[5px] bg-[#efece5] px-1 py-[1px] font-mono ${s.code} text-[#4a433b]`}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre
        className={`${s.gap} overflow-x-auto rounded-[10px] border border-[#e4e0d8] bg-[#f2efe8] ${s.pad} last:mb-0`}
      >
        {children}
      </pre>
    ),

    blockquote: ({ children }) => (
      <blockquote
        className={`${s.gap} border-l-2 border-[#dcd5c8] pl-2.5 italic text-[#6d665d] last:mb-0`}
      >
        {children}
      </blockquote>
    ),

    hr: () => <hr className="my-3 border-[#e4e0d8]" />,

    // Таблица прокручивается в своём контейнере: панель узкая, и без этого
    // широкая таблица растянула бы всю ленту сообщений.
    table: ({ children }) => (
      <div className={`${s.gap} overflow-x-auto last:mb-0`}>
        <table className={`w-full border-collapse ${s.table}`}>{children}</table>
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
}

// Оба набора строятся один раз при загрузке модуля, а не на каждый рендер:
// иначе `react-markdown` получал бы новый объект компонентов на каждую букву
// потока и перерисовывал ответ целиком.
const COMPONENTS: Record<"rail" | "page", Components> = {
  rail: buildComponents(SCALES.rail),
  page: buildComponents(SCALES.page),
};

const PLUGINS_REMARK = [remarkGfm, remarkBreaks, remarkMath];
const PLUGINS_REHYPE = [rehypeKatex];

export function MarkdownMessage({
  content,
  className,
  variant = "rail",
}: {
  content: string;
  className?: string;
  /** Ширина, в которой читают: узкая панель или колонка страницы. */
  variant?: "rail" | "page";
}) {
  return (
    <div className={`chat-markdown ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={PLUGINS_REMARK}
        rehypePlugins={PLUGINS_REHYPE}
        components={COMPONENTS[variant]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
