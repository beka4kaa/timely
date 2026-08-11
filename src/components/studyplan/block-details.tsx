// Карточка занятия: что именно делать и по чему это проверяется.
//
// Показывается ровно то, что бэкенд действительно знает. Кнопок «Начать» и
// «Спросить AI» здесь нет намеренно: соответствующих endpoint'ов ещё не
// существует, а кнопка, которая ничего не делает, хуже её отсутствия.

"use client";

import {
  commitmentKindLabel,
  courseAccent,
  isCommitmentEntry,
} from "@/lib/studyplan-calendar-entries";
import { formatMinutes, zonedDateKey, zonedMinutes } from "@/lib/studyplan-calendar";
import {
  blockAppearance,
  dayLabel,
  durationLabel,
} from "@/lib/studyplan-visuals";
import { paperButton, paperCaption, paperCard, paperTile } from "@/components/curriculum/paper";

import type { CalendarEntry } from "./use-schedule";

const WORKSPACE_LABELS: Record<string, string> = {
  tutor_chat: "Чат с наставником",
  smart_board: "Научная доска",
  paper_notebook: "Тетрадь",
  answer_form: "Форма ответа",
  built_in_code_editor: "Редактор кода",
  external_ide: "Внешняя среда",
  book_reader: "Читалка книги",
  quiz: "Короткий опрос",
  voice: "Голос",
  offline: "Вне приложения",
  project_workspace: "Проект",
};

interface BlockDetailsProps {
  block: CalendarEntry | null;
  timeZone: string;
  onClose: () => void;
}

export function BlockDetails({ block, timeZone, onClose }: BlockDetailsProps) {
  if (!block) {
    return (
      <div className={`${paperCard} px-4 py-6 text-[13px] text-[#7b7168]`}>
        Выбери занятие в календаре, чтобы увидеть, что именно нужно сделать.
      </div>
    );
  }

  if (isCommitmentEntry(block)) {
    return <CommitmentDetails block={block} timeZone={timeZone} onClose={onClose} />;
  }

  // Занятое время ушло веткой выше, значит здесь всегда учебный блок и у него
  // есть свой курс.
  const look = blockAppearance(block, { accent: courseAccent(block.course_plan) });
  const startMinutes = zonedMinutes(block.start_at, timeZone);
  const dateKey = zonedDateKey(block.start_at, timeZone);
  const payload = block.lesson_payload as {
    completion?: string;
    sources?: { section_ids?: string[] };
  };
  const completion = payload?.completion || block.mastery_criteria;
  const sections = payload?.sources?.section_ids ?? block.source_section_ids ?? [];

  return (
    <div className={`${paperCard} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={paperCaption}>{look.label}</div>
          <h2 className="mt-1 text-[16px] font-medium leading-snug text-[#312c27]">
            {block.title}
          </h2>
        </div>
        <button type="button" className={paperButton} onClick={onClose}>
          Закрыть
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#5f584f]">
        <span className="tabular-nums">
          {dayLabel(dateKey)}, {formatMinutes(startMinutes)}
        </span>
        <span className="text-[#c4bbae]">·</span>
        <span className="tabular-nums">{durationLabel(block.duration_minutes)}</span>
        {look.statusLabel ? (
          <>
            <span className="text-[#c4bbae]">·</span>
            <span>{look.statusLabel}</span>
          </>
        ) : null}
      </div>

      {block.objective ? (
        <p className="mt-3 text-[13.5px] leading-relaxed text-[#4a443d]">
          {block.objective}
        </p>
      ) : null}

      <dl className="mt-4 space-y-2">
        <Row label="Программа">{block.course_plan_title}</Row>

        <Row label="Где заниматься">
          {WORKSPACE_LABELS[block.workspace_type] ?? block.workspace_type}
        </Row>

        {completion ? <Row label="Когда считать сделанным">{completion}</Row> : null}

        {sections.length > 0 ? (
          <Row label="По какому месту книги">{sections.join(", ")}</Row>
        ) : null}

        {block.review_step != null ? (
          <Row label="Повторение">
            {["через 2 дня", "через неделю", "через три недели"][block.review_step] ??
              "по плану"}
          </Row>
        ) : null}

        {block.fixed ? (
          <Row label="Закреплено">Это занятие планировщик не переносит.</Row>
        ) : null}
      </dl>

      {block.schedule_status === "proposed" || block.schedule_status === "draft" ? (
        <p className={`${paperTile} mt-4 px-3 py-2 text-[12px] leading-relaxed text-[#7b7168]`}>
          Это предварительное время. Оно станет постоянным после подтверждения
          программы.
        </p>
      ) : null}

      {block.detail_level === "outline" ? (
        <p className={`${paperTile} mt-4 px-3 py-2 text-[12px] leading-relaxed text-[#7b7168]`}>
          Дата и тема уже назначены, а конкретные задания появятся ближе к
          занятию — по тому, что к тому моменту будет освоено.
        </p>
      ) : null}
    </div>
  );
}

function CommitmentDetails({
  block,
  timeZone,
  onClose,
}: {
  block: Extract<CalendarEntry, { calendar_entry: "commitment" }>;
  timeZone: string;
  onClose: () => void;
}) {
  const startMinutes = zonedMinutes(block.start_at, timeZone);
  const dateKey = zonedDateKey(block.start_at, timeZone);

  return (
    <div className={`${paperCard} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={paperCaption}>
            {commitmentKindLabel(block.commitment_kind)} · занятое время
          </div>
          <h2 className="mt-1 text-[16px] font-medium leading-snug text-[#312c27]">
            {block.title}
          </h2>
        </div>
        <button type="button" className={paperButton} onClick={onClose}>
          Закрыть
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#5f584f]">
        <span className="tabular-nums">
          {dayLabel(dateKey)}, {formatMinutes(startMinutes)}
        </span>
        <span className="text-[#c4bbae]">·</span>
        <span className="tabular-nums">{durationLabel(block.duration_minutes)}</span>
      </div>

      {block.objective ? (
        <p className="mt-3 text-[13.5px] leading-relaxed text-[#4a443d]">
          {block.objective}
        </p>
      ) : null}

      <p className={`${paperTile} mt-4 px-3 py-2 text-[12px] leading-relaxed text-[#7b7168]`}>
        Это время занято и не перетаскивается. Планировщик размещает учебные
        занятия вокруг него.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[128px_1fr] gap-2">
      <dt className={`${paperCaption} pt-0.5`}>{label}</dt>
      <dd className="text-[13px] leading-relaxed text-[#4a443d]">{children}</dd>
    </div>
  );
}
