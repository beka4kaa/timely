import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import type { AdminContest, Contest, ContestFileInfo } from "./contest-api";
import {
  draftFromAdmin,
  draftToInput,
  durationLabel,
  emptyDraft,
  pointsBudget,
  publishBlockers,
  type ContestDraft,
} from "./contest-form";
import { layoutContests } from "./contest-layout";
import { ARTS, TIERS, canSetTier, tierMeta } from "./contest-tiers";
import { adminBadge, answerErrorText, attemptClock, contestStateAt, plaqueOf, plaqueRules, reviewPrompt, taskRows } from "./contest-view";

const PDF: ContestFileInfo = { id: 7, name: "z.pdf", size: 100, pages: 1 };

function window(id: number, start: string, end: string) {
  return { id, start_time: start, end_time: end };
}

function contest(patch: Partial<Contest> = {}): Contest {
  return {
    id: 1,
    title: "Кубок",
    description: "",
    start_time: "2026-11-12T06:00:00Z",
    end_time: "2026-11-12T09:00:00Z",
    tier: 2,
    art: "rings",
    state: "running",
    tasks: [10, 11],
    task_count: 2,
    points_total: 300,
    task_details: [],
    created_at: "2026-11-01T00:00:00Z",
    ...patch,
  };
}

function admin(patch: Partial<AdminContest> = {}): AdminContest {
  return {
    id: 1,
    title: "Кубок",
    description: "Описание",
    start_time: "2026-11-12T06:00:00Z",
    end_time: "2026-11-12T09:00:00Z",
    tier: 2,
    art: "waves",
    state: "upcoming",
    created_at: "2026-11-01T00:00:00Z",
    is_published: true,
    points_total: 250,
    tier_cap: 400,
    participants: 0,
    attempts: 0,
    can_delete: true,
    locked: false,
    tasks: [],
    ...patch,
  };
}

function draft(patch: Partial<ContestDraft> = {}): ContestDraft {
  return {
    title: "Кубок",
    description: "",
    start: new Date(2026, 10, 12, 11, 0),
    end: new Date(2026, 10, 12, 14, 0),
    tier: 2,
    art: "rings",
    tasks: [
      { key: "a", answer: "60", points: 150, statement: PDF, solution: null, legacyText: "" },
      { key: "b", answer: "1", points: 100, statement: PDF, solution: null, legacyText: "" },
      { key: "c", answer: "2", points: 100, statement: PDF, solution: null, legacyText: "" },
    ],
    ...patch,
  };
}

describe("тиры", () => {
  it("потолки и имена как в описании", () => {
    assert.deepEqual(
      TIERS.map((tier) => [tier.tier, tier.name, tier.cap, tier.className]),
      [
        [1, "Аметист", 800, "tier-1"],
        [2, "Алмаз", 400, "tier-2"],
        [3, "Золото", 200, "tier-3"],
        [4, "Серебро", 100, "tier-4"],
        [5, "Бронза", 50, "tier-5"],
      ],
    );
    assert.equal(tierMeta(9).name, "Бронза");
    assert.equal(ARTS.length, 12);
    assert.equal(ARTS[0].label, "Кольца");
  });

  it("тиры 1 и 2 только у владельца", () => {
    assert.equal(canSetTier({ is_staff: false }, 2), false);
    assert.equal(canSetTier({ is_staff: false }, 3), true);
    assert.equal(canSetTier({ is_staff: true }, 1), true);
  });
});

describe("сетка контестов", () => {
  const now = new Date("2026-11-12T07:00:00Z");
  const running = window(1, "2026-11-12T06:00:00Z", "2026-11-12T09:00:00Z");
  const soon = window(2, "2026-11-13T06:00:00Z", "2026-11-13T09:00:00Z");
  const later = window(3, "2026-11-20T06:00:00Z", "2026-11-20T09:00:00Z");
  const latest = window(4, "2026-11-25T06:00:00Z", "2026-11-25T09:00:00Z");
  const old = window(5, "2026-10-01T06:00:00Z", "2026-10-01T09:00:00Z");
  const older = window(6, "2026-09-01T06:00:00Z", "2026-09-01T09:00:00Z");

  it("идущий контест встаёт билетом раньше ближайшего", () => {
    const layout = layoutContests([soon, older, running, old], now);
    assert.equal(layout.hero, running);
    assert.deepEqual(layout.next.map((slot) => [slot.contest.id, slot.size]), [[2, "wide"]]);
    assert.deepEqual(layout.past.map((row) => row.id), [5, 6]);
  });

  it("нечётная последняя карточка растягивается, чётные идут парами", () => {
    const three = layoutContests([running, soon, later, latest], now);
    assert.deepEqual(three.next.map((slot) => slot.size), ["card", "card", "wide"]);
    const two = layoutContests([running, soon, later], now);
    assert.deepEqual(two.next.map((slot) => slot.size), ["card", "card"]);
  });

  it("без будущих и идущих билета нет", () => {
    const layout = layoutContests([old], now);
    assert.equal(layout.hero, null);
    assert.deepEqual(layout.next, []);
  });
});

describe("форма контеста", () => {
  it("по умолчанию завтра в 11:00 на три часа", () => {
    const fresh = emptyDraft(new Date(2026, 10, 11, 15, 0));
    assert.equal(fresh.start.getTime(), new Date(2026, 10, 12, 11, 0).getTime());
    assert.equal(fresh.end.getTime(), new Date(2026, 10, 12, 14, 0).getTime());
    assert.equal(fresh.tier, 5);
    assert.equal(fresh.art, "rings");
    assert.equal(fresh.tasks.length, 1);
    assert.equal(fresh.tasks[0].points, 10);
  });

  it("отдаёт даты в UTC и задачи в порядке формы", () => {
    const value = draft({ tasks: [{ key: "a", id: 5, answer: " 60 ", points: 150, statement: PDF, solution: null, legacyText: "" }] });
    const input = draftToInput(value);
    assert.equal(input.start_time, value.start.toISOString());
    assert.equal(input.end_time, value.end.toISOString());
    assert.deepEqual(input.tasks, [{ id: 5, answer: "60", points: 150, statement_file: 7, solution_file: null }]);
  });

  it("собирается из ответа админки", () => {
    const value = draftFromAdmin(admin({
      tasks: [{ id: 3, number: 1, title: "Сумма цифр", condition_text: "Старое", answer: "15", points: 50, statement: null, solution: PDF }],
    }));
    assert.equal(value.start.toISOString(), "2026-11-12T06:00:00.000Z");
    assert.equal(value.tasks[0].id, 3);
    assert.equal(value.tasks[0].legacyText, "Старое");
    assert.equal(value.tasks[0].solution?.id, 7);
  });

  it("считает бюджет баллов тира", () => {
    assert.deepEqual(pointsBudget(draft()), { total: 350, cap: 400, over: 0, share: 0.875 });
    assert.equal(pointsBudget(draft({ tier: 3 })).over, 150);
  });

  it("говорит, что мешает публикации", () => {
    const value = draft({
      tier: 1,
      tasks: [
        { key: "a", answer: "", points: 500, statement: null, solution: null, legacyText: "" },
        { key: "b", answer: "1", points: 0, statement: PDF, solution: null, legacyText: "" },
      ],
    });
    assert.deepEqual(publishBlockers(value, new Date(2026, 10, 11), false), [
      "Этот тир ставит только владелец.",
      "У задачи 1 нет PDF условия.",
      "У задачи 1 нет ответа.",
      "Баллы задачи 2 от 1.",
    ]);
    assert.deepEqual(publishBlockers(draft({ tier: 3 }), new Date(2026, 10, 11), true), ["Сумма 350 больше потолка тира: 200."]);
    assert.deepEqual(publishBlockers(draft(), new Date(2026, 10, 13), true), ["Конец уже прошёл."]);
    assert.deepEqual(publishBlockers(draft({ title: " " }), new Date(2026, 10, 11), true), ["Напиши название."]);
  });

  it("пишет длительность", () => {
    const start = new Date(2026, 10, 12, 11, 0);
    const after = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
    assert.equal(durationLabel(start, after(180)), "Длится 3 часа");
    assert.equal(durationLabel(start, after(90)), "Длится 1 час 30 минут");
    assert.equal(durationLabel(start, after(2880)), "Длится 2 дня");
    assert.equal(durationLabel(start, after(-10)), "Конец раньше начала");
  });
});

describe("страница контеста", () => {
  it("часы ленты считаются от начала", () => {
    assert.equal(attemptClock(42), "0:00");
    assert.equal(attemptClock(2580), "0:43");
    assert.equal(attemptClock(3900), "1:05");
  });

  it("ошибки ответа понятные, а незнакомая общая", () => {
    assert.equal(answerErrorText("not_running"), "Контест сейчас не идёт.");
    assert.equal(answerErrorText("too_fast"), "Подожди пару секунд.");
    assert.equal(answerErrorText("что-то"), "Не получилось проверить. Попробуй ещё раз.");
  });

  it("склеивает задачи со своими попытками", () => {
    const value = contest({
      task_details: [
        { id: 10, number: 1, title: "", points: 100, has_statement: true, condition_text: "" },
        { id: 11, number: 2, title: "", points: 200, has_statement: true, condition_text: "" },
      ],
      mine: [{ task: 11, attempts: 2, solved: false, last_answer: "9" }],
    });
    const rows = taskRows(value);
    assert.equal(rows[0].mine, null);
    assert.deepEqual(rows[1].mine, { task: 11, attempts: 2, solved: false, last_answer: "9" });
  });

  it("состояние по часам браузера", () => {
    const value = contest();
    assert.equal(contestStateAt(value, new Date("2026-11-12T05:59:00Z")), "upcoming");
    assert.equal(contestStateAt(value, new Date("2026-11-12T06:00:00Z")), "running");
    assert.equal(contestStateAt(value, new Date("2026-11-12T09:00:00Z")), "ended");
  });

  it("тьютору уходит текст из PDF, а без него старое условие", () => {
    const prompt = reviewPrompt(contest({
      title: "Кубок",
      task_details: [
        { id: 10, number: 1, title: "", points: 100, has_statement: true, condition_text: "", review_text: "Найди угол" },
        { id: 11, number: 2, title: "Старая", points: 100, has_statement: false, condition_text: "Реши" },
      ],
    }));
    assert.equal(prompt, "Разбери со мной контест «Кубок». Вот задачи:\n1. Задача 1: Найди угол\n2. Старая: Реши");
  });
});

describe("метки админки", () => {
  const now = new Date(2026, 10, 11, 15, 0);
  it("черновик, скоро, идёт и прошёл", () => {
    assert.equal(adminBadge(admin({ is_published: false }), now), "Черновик");
    assert.equal(adminBadge(admin({ start_time: new Date(2026, 10, 16, 11, 0).toISOString() }), now), "Через 5 дней");
    assert.equal(adminBadge(admin({ start_time: new Date(2026, 10, 12, 11, 0).toISOString() }), now), "Завтра");
    assert.equal(adminBadge(admin({ start_time: new Date(2026, 10, 11, 18, 30).toISOString() }), now), "Сегодня в 18:30");
    assert.equal(
      adminBadge(admin({ state: "running", start_time: new Date(2026, 10, 11, 14, 0).toISOString(), end_time: new Date(2026, 10, 11, 17, 0).toISOString(), participants: 38 }), now),
      "Идёт, 38 участников",
    );
    assert.equal(
      adminBadge(admin({ state: "ended", start_time: new Date(2026, 10, 1, 11, 0).toISOString(), end_time: new Date(2026, 10, 1, 14, 0).toISOString(), participants: 41 }), now),
      "Прошёл, 41 участник",
    );
  });
});

describe("плашка", () => {
  it("одинаково читает контест ученика и админки", () => {
    const fromStudent = plaqueOf(contest({ task_count: 3, points_total: 300 }));
    const fromAdmin = plaqueOf(admin({ points_total: 250, tasks: [
      { id: 1, number: 1, title: "", condition_text: "", answer: "1", points: 150, statement: PDF, solution: null },
      { id: 2, number: 2, title: "", condition_text: "", answer: "2", points: 100, statement: PDF, solution: null },
    ] }));
    assert.deepEqual([fromStudent.taskCount, fromStudent.points, fromStudent.tier], [3, 300, 2]);
    assert.deepEqual([fromAdmin.taskCount, fromAdmin.points, fromAdmin.art], [2, 250, "waves"]);
  });

  it("правила: задачи, длительность и сколько можно получить", () => {
    assert.equal(plaqueRules(plaqueOf(contest({ task_count: 4, points_total: 750 }))), "4 задачи, 3 часа, до 750 баллов");
    assert.equal(plaqueRules(plaqueOf(contest({ task_count: 0, points_total: 0 }))), "3 часа");
    assert.equal(plaqueRules(plaqueOf(contest({ task_count: 1, points_total: 50 })), { duration: false }), "1 задача, до 50 баллов");
  });
});
