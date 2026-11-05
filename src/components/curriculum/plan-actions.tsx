// Действия над программой: инструменты в шапке страницы.
//
// У отклонённой программы кнопка подтверждения СКРЫТА, а не заблокирована. Отключённая
// главная кнопка без объяснения читается как поломка интерфейса; её отсутствие вместе с
// текстом причины как решение системы.
//
// «Построить заново» архивирует предыдущую версию и доступна всегда, в том числе по
// холодной ссылке. Новая программа живёт по своему адресу, поэтому после перестройки
// страница переходит на неё, а не подменяет данные.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { type CoursePlan, generateMaterialPlan, rebuildPlan } from "@/lib/curriculum-api";

import { OverflowMenu } from "./catalog-menu";

export function PlanActions({
  plan,
  approving,
  onApprove,
  onEditPace,
  onEditStructure,
  onError,
}: {
  plan: CoursePlan;
  approving: boolean;
  onApprove: () => void;
  onEditPace: () => void;
  onEditStructure: () => void;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [rebuilding, setRebuilding] = useState(false);

  // Перестройка это минута работы модели: о ней говорит маскот, а кнопка занята.
  useEffect(() => {
    if (!rebuilding) return;
    mascot.thinkStart("Строю программу заново");
    mascot.thought("Читаю оглавление и подбираю темы");
    return () => mascot.thinkEnd();
  }, [rebuilding]);

  const rebuild = async () => {
    setRebuilding(true);
    onError(null);
    try {
      // У программы по источнику без файла пересборка своя: планировщику нечего читать,
      // зато пересчитать занятия по новым числам можно точно.
      const result = plan.material
        ? await generateMaterialPlan(plan.material)
        : await rebuildPlan(plan.id);
      router.replace(`/dashboard/curriculum/plan/${result.plan.id}`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Не получилось построить программу заново.");
    } finally {
      setRebuilding(false);
    }
  };

  const archived = plan.status === "archived";
  const active = plan.status === "active";
  const approvable = plan.status !== "rejected" && !archived && !active;
  // Состав подтверждённой программы не правится: по ней уже занимаются, и версия защищена от
  // изменения. Для неё остаётся «построить заново».
  const editable = !archived && !active;

  if (archived) return null;

  return (
    <>
      {/* Темп меняет расписание, а не состав тем, поэтому доступен и на подтверждённой программе. */}
      <button type="button" className="btn btn-text" onClick={onEditPace}>
        Изменить темп
      </button>

      <OverflowMenu label="Другие действия">
        {(close) => (
          <>
            {editable ? (
              <button
                type="button"
                disabled={rebuilding || approving}
                onClick={() => {
                  close();
                  onEditStructure();
                }}
              >
                Править состав
              </button>
            ) : null}
            <button
              type="button"
              disabled={rebuilding || approving}
              onClick={() => {
                close();
                void rebuild();
              }}
            >
              {rebuilding ? "Строю заново…" : "Построить заново"}
            </button>
          </>
        )}
      </OverflowMenu>

      {approvable ? (
        <button type="button" onClick={onApprove} disabled={approving} className="btn btn-main">
          {approving ? "Секунду…" : "Начать заниматься"}
        </button>
      ) : null}
      {active ? (
        <Link href="/dashboard/plan" className="btn btn-main">
          Открыть план
        </Link>
      ) : null}
    </>
  );
}
