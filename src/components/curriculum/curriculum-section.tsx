// Что показывает раздел «Курс по книге»: каталог или мастер добавления.
//
// Раньше страница открывала мастер сразу, и это делало раздел одноразовым:
// второй предмет затирал первый, а построенные программы жили только по прямой
// ссылке. Теперь по умолчанию виден каталог, а мастер — это действие внутри
// него.
//
// Решение «что показать» живёт здесь, а не в сторе: стор описывает ОДИН сеанс
// добавления, и подмешивать в него режим экрана значило бы сохранять этот режим
// в localStorage вместе с идентификаторами.

"use client";

import { useEffect, useState } from "react";

import { CurriculumCatalog } from "@/components/curriculum/catalog";
import { CurriculumWizard } from "@/components/curriculum/curriculum-wizard";
import { useCurriculumStore } from "@/stores/curriculum-store";

type Mode = "catalog" | "wizard";

export function CurriculumSection() {
  const [mode, setMode] = useState<Mode>("catalog");
  const hydrated = useCurriculumStore((s) => s.hydrated);
  const goalId = useCurriculumStore((s) => s.goalId);
  const step = useCurriculumStore((s) => s.step);
  const hydrateFromServer = useCurriculumStore((s) => s.hydrateFromServer);
  const startNewSubject = useCurriculumStore((s) => s.startNewSubject);
  const addBookToSubject = useCurriculumStore((s) => s.addBookToSubject);

  // Состояние мастера восстанавливается ДО выбора режима: незаконченное
  // добавление переживает перезагрузку, и человек должен вернуться в него, а не
  // в каталог, где его книги ещё нет.
  useEffect(() => {
    void hydrateFromServer();
  }, [hydrateFromServer]);

  useEffect(() => {
    if (hydrated && goalId && step !== "goal") setMode("wizard");
  }, [hydrated, goalId, step]);

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
        onAddBook={(id) => {
          addBookToSubject(id);
          setMode("wizard");
        }}
      />
    </div>
  );
}
