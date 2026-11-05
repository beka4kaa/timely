// Что показывает раздел «Курсы и книги»: стеллаж или мастер добавления.
//
// Раздел ВСЕГДА открывается стеллажом. Это не мелочь оформления: мастер хранил
// последний сеанс в localStorage, и попытка «вернуть человека туда, где он был»
// приводила к тому, что заход в раздел молча уводил на страницу давно построенной
// программы. Адрес раздела обязан показывать раздел.
//
// Незаконченная работа при этом не теряется, она видна на полке: предмет без книги,
// книга в обработке, программа без подтверждения. Вернуться в мастер можно, но только
// нажав на это самому.
//
// Решение «что показать» живёт здесь, а не в сторе: стор описывает ОДИН сеанс
// добавления, и подмешивать в него режим экрана незачем.

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
    return <CurriculumWizard onClose={() => setMode("catalog")} />;
  }

  return (
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
  );
}
