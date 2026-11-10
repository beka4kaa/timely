"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { FaqItem } from "./copy";
import styles from "./faq.module.css";

export function Faq({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className={styles.list}>
      {items.map((item, index) => {
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
