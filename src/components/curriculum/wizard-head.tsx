// Заголовок шага мастера: у каждого шага свой вопрос крупно и одна строка пояснения.

import type { ReactNode } from "react";

export function WizardHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <header className="head">
        <h1 className="title">{title}</h1>
      </header>
      {children ? <p className="lede">{children}</p> : null}
    </>
  );
}
