// Что показывает раздел «Курс по книге»: каталог или мастер добавления.
//
// Раздел ВСЕГДА открывается каталогом. Это не мелочь оформления: мастер хранит
// последний сеанс в localStorage, и попытка «вернуть человека туда, где он был»
// приводила к тому, что заход на /curriculum молча уводил на страницу давно
// построенной программы. Адрес раздела обязан показывать раздел.
//
// Незаконченная работа при этом не теряется — она видна в каталоге: предмет без
// книги, книга в обработке, программа без подтверждения. Вернуться в мастер
// можно, но только нажав на это самому.
//
// Решение «что показать» живёт здесь, а не в сторе: стор описывает ОДИН сеанс
// добавления, и подмешивать в него режим экрана значило бы сохранять этот режим
// в localStorage вместе с идентификаторами.

"use client";

import { useState } from "react";

import { CurriculumCatalog } from "@/components/curriculum/catalog";
import { CurriculumWizard } from "@/components/curriculum/curriculum-wizard";
import { useCurriculumStore } from "@/stores/curriculum-store";

type Mode = "catalog" | "wizard";

export function CurriculumSection() {
  const [mode, setMode] = useState<Mode>("catalog");
  const startNewSubject = useCurriculumStore((s) => s.startNewSubject);
  const addBookToSubject = useCurriculumStore((s) => s.addBookToSubject);
  const openSubjectSetup = useCurriculumStore((s) => s.openSubjectSetup);
  const openBookProgress = useCurriculumStore((s) => s.openBookProgress);

  if (mode === "wizard") {
    return (
      <div className="w-full max-w-[760px]">
        <CurriculumWizard onClose={() => setMode("catalog")} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[860px]">
      <CurriculumCatalog
        onAddSubject={() => {
          startNewSubject();
          setMode("wizard");
        }}
        onAddBook={(goalId) => {
          addBookToSubject(goalId);
          setMode("wizard");
        }}
        onContinueSetup={(goal) => {
          openSubjectSetup(goal);
          setMode("wizard");
        }}
        onShowProgress={(goalId, document) => {
          openBookProgress(goalId, document);
          setMode("wizard");
        }}
      />
    </div>
  );
}
