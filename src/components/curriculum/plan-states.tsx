// Пограничные состояния страницы программы.

"use client";

import Link from "next/link";
import { msg, t } from "@/lib/i18n";

import { SECTION_LABEL } from "@/lib/curriculum-books";

import type { PlanPageErrorKind } from "./use-plan-page-data";

export function PlanPageSkeleton() {
  return (
    <div className="content view cur-page" aria-busy="true" aria-label={t("Загружаю программу")}>
      <span className="back">{t(SECTION_LABEL)}</span>
      <div className="course-skel" aria-hidden="true">
        <span className="cur-skel skel-t" />
        <span className="cur-skel skel-l" />
        <span className="card skel-path" />
        <span className="cur-skel skel-row" />
        <span className="cur-skel skel-row" />
        <span className="cur-skel skel-row" />
      </div>
    </div>
  );
}

const TITLES: Record<PlanPageErrorKind, string> = {
  not_found: msg("Программа не найдена"),
  forbidden: msg("Нет доступа к этой программе"),
  network: msg("Программа не загрузилась"),
};

export function PlanPageError({
  kind,
  message,
  onRetry,
}: {
  kind: PlanPageErrorKind;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="content view cur-page">
      <Link className="back" href="/dashboard/curriculum">
        {t(SECTION_LABEL)}
      </Link>
      <header className="head">
        <h1 className="title">{t(TITLES[kind])}</h1>
      </header>
      <p className="lede">{message}</p>
      <div className="cur-acts">
        {kind === "network" ? (
          <button type="button" onClick={onRetry} className="btn btn-main">
            {t("Повторить")}
          </button>
        ) : (
          <Link href="/dashboard/curriculum" className="btn btn-main">
            {t("К курсам и книгам")}
          </Link>
        )}
      </div>
    </div>
  );
}
