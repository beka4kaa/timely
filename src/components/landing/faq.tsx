"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import styles from "./faq.module.css";

const ITEMS = [
  {
    q: "Что такое Timely?",
    a: "Учебное пространство для школьников: дневник, план и AI-тьютор в одном месте. Timely показывает, что делать сейчас, и помогает, когда застрял.",
  },
  {
    q: "Тьютор решит задачу за меня?",
    a: "Нет, и это специально. Он идёт от условия к решению вместе с тобой: подсказки выдаются по одной, а следующий шаг каждый раз остаётся за тобой.",
  },
  {
    q: "Можно заниматься по своему учебнику?",
    a: "Да. Загрузи учебник в разделе «Курс по книге»: Timely разберёт его на модули, темы и страницы, а тьютор будет отвечать со ссылкой на страницу.",
  },
  {
    q: "Какие предметы поддерживаются?",
    a: "Любые школьные — от алгебры и физики до истории и языков. Если у предмета есть загруженный учебник, ответы опираются на него, если нет — тьютор объясняет своими словами.",
  },
  {
    q: "Нужен ли отдельный дневник или таймер?",
    a: "Нет. Расписание, оценки, задачи, помодоро и привычки уже внутри Timely, рядом с планом.",
  },
  {
    q: "Как начать?",
    a: "Нажми «Открыть Timely» и войди через Google или по почте. Начни с вопроса по сегодняшней домашке.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className={styles.list}>
      {ITEMS.map((item, index) => {
        const expanded = open === index;
        return (
          <div key={item.q} className={styles.item} data-open={expanded}>
            <h3 className={styles.heading}>
              <button
                type="button"
                id={`faq-q-${index}`}
                className={styles.question}
                aria-expanded={expanded}
                aria-controls={`faq-a-${index}`}
                onClick={() => setOpen(expanded ? null : index)}
              >
                {item.q}
                <Plus className={styles.icon} size={20} strokeWidth={1.8} />
              </button>
            </h3>
            <div
              id={`faq-a-${index}`}
              role="region"
              aria-labelledby={`faq-q-${index}`}
              aria-hidden={!expanded}
              className={styles.answer}
            >
              <div className={styles.answerInner}>
                <p>{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
