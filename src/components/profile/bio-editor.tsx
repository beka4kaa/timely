"use client";

// «О себе»: поле на месте текста. Хранится на сервере, видит только сам ученик.

import { useEffect, useRef } from "react";

import { t } from "@/lib/i18n";
import { useSmoothInput } from "@/components/shell/smooth-input";

/** Столько принимает `CustomUser.bio`. */
export const BIO_LIMIT = 280;

export function BioEditor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useSmoothInput(field);

  // Поле растёт вместе с текстом: описание должно быть видно целиком.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  return (
    <div className="pf-bio-edit">
      <span className="ti-host pf-bio-host">
        <textarea
          ref={field}
          rows={2}
          value={value}
          maxLength={BIO_LIMIT}
          aria-label={t("О себе")}
          placeholder={t("Что учишь и зачем")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSave();
            }
          }}
        />
      </span>
      <p className="small-note pf-bio-note">
        {t("{n} из {max}. Видишь только ты.", { n: value.length, max: BIO_LIMIT })}
      </p>
    </div>
  );
}
