import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import type { Contest, LeaderboardUser, Submission } from "./contest-api";
import {
  contestParts,
  contestResult,
  contestRules,
  contestTone,
  countdown,
  ownSubmissions,
  reviewPrompt,
  ru,
  splitContests,
} from "./contest-view";
import {
  computeBadges,
  dayKeyOf,
  heatCells,
  hoursStat,
  mergeActivity,
  monthAxis,
  solvedTasks,
  streaksOf,
  weekBars,
} from "./profile-view";
import { buildBoard, neighboursOf, shareToNext, subjectsOf, visibleLines, weeklyGain } from "./rating-view";

function contest(patch: Partial<Contest> = {}): Contest {
  return {
    id: 1,
    title: "Контест",
    description: "",
    start_time: "2026-11-07T06:00:00Z",
    end_time: "2026-11-07T07:30:00Z",
    tasks: [1, 2, 3, 4],
    task_details: [],
    created_at: "2026-11-01T00:00:00Z",
    ...patch,
  };
}

function submission(patch: Partial<Submission> = {}): Submission {
  return {
    id: 1,
    student: 7,
    student_name: "",
    student_email: "",
    task: 1,
    task_title: "Задача",
    task_points: 100,
    file_url_or_code: "",
    student_solution_image: "",
    status: "approved",
    reviewed_at: "2026-11-07T09:00:00Z",
    created_at: "2026-11-07T06:10:00Z",
    ...patch,
  };
}

function user(id: number, elo: number, patch: Partial<LeaderboardUser> = {}): LeaderboardUser {
  return { id, username: `u${id}`, country_code: null, city: null, overall_elo: elo, ratings: [], ...patch };
}

describe("контесты", () => {
  it("склоняет числа", () => {
    assert.equal(ru(1, "день", "дня", "дней"), "день");
    assert.equal(ru(3, "день", "дня", "дней"), "дня");
    assert.equal(ru(11, "день", "дня", "дней"), "дней");
    assert.equal(ru(21, "день", "дня", "дней"), "день");
  });

  it("красит плашку предметом из названия, а без предмета оставляет индиго", () => {
    assert.equal(contestTone("Контест по физике 42"), "p-rose");
    assert.equal(contestTone("Контест по алгебре 12"), "p-indigo");
    assert.equal(contestTone("Контест по химии 7"), "p-teal");
    assert.equal(contestTone("Контест по истории 2"), "p-blue");
    // Название без предмета не должно получать случайный цвет из запасного правила.
    assert.equal(contestTone("Еженедельный контест 505"), "p-indigo");
    assert.equal(contestTone("Еженедельный контест 506"), "p-indigo");
  });

  it("делит название на номер и вид", () => {
    assert.deepEqual(contestParts("Еженедельный контест 505"), { number: "505", kind: "Еженедельный" });
    assert.deepEqual(contestParts("Контест по физике 42"), { number: "42", kind: "По физике" });
    assert.deepEqual(contestParts("Контест №7"), { number: "7", kind: "Контест" });
    assert.deepEqual(contestParts("Весенний кубок"), { number: null, kind: "Весенний кубок" });
    assert.deepEqual(contestParts("505"), { number: "505", kind: "Контест" });
  });

  it("раскладывает контесты по времени", () => {
    const now = new Date("2026-11-07T06:30:00Z");
    const running = contest({ id: 1 });
    const later = contest({ id: 2, start_time: "2026-11-09T06:00:00Z", end_time: "2026-11-09T07:00:00Z" });
    const soon = contest({ id: 3, start_time: "2026-11-08T06:00:00Z", end_time: "2026-11-08T07:00:00Z" });
    const old = contest({ id: 4, start_time: "2026-10-01T06:00:00Z", end_time: "2026-10-01T07:00:00Z" });
    const older = contest({ id: 5, start_time: "2026-09-01T06:00:00Z", end_time: "2026-09-01T07:00:00Z" });
    const groups = splitContests([older, later, running, old, soon], now);
    assert.deepEqual(groups.running.map((row) => row.id), [1]);
    assert.deepEqual(groups.upcoming.map((row) => row.id), [3, 2]);
    assert.deepEqual(groups.past.map((row) => row.id), [4, 5]);
  });

  it("считает, сколько осталось, двумя самыми крупными единицами", () => {
    const now = new Date("2026-11-04T00:00:00Z");
    assert.deepEqual(countdown("2026-11-07T18:00:00Z", now), [
      { value: 3, unit: "дня" },
      { value: 18, unit: "ч" },
    ]);
    assert.deepEqual(countdown("2026-11-04T02:14:00Z", now), [
      { value: 2, unit: "ч" },
      { value: 14, unit: "мин" },
    ]);
    assert.deepEqual(countdown("2026-11-04T00:05:00Z", now), [{ value: 5, unit: "мин" }]);
    assert.deepEqual(countdown("2026-11-05T00:00:00Z", now), [{ value: 1, unit: "день" }]);
  });

  it("описывает условия и не выдумывает число задач", () => {
    assert.equal(contestRules(contest()), "4 задачи, 90 минут");
    assert.equal(contestRules(contest({ tasks: [] })), "90 минут");
  });

  it("считает результат только по решениям во время контеста", () => {
    const rows = [
      submission({ id: 1, task: 1, task_points: 40 }),
      // Та же задача сдана дважды: баллы один раз.
      submission({ id: 2, task: 1, task_points: 40 }),
      submission({ id: 3, task: 2, status: "pending", reviewed_at: null }),
      submission({ id: 4, task: 3, status: "rejected" }),
      // После конца контеста и чужая задача не считаются.
      submission({ id: 5, task: 4, created_at: "2026-11-08T06:10:00Z" }),
      submission({ id: 6, task: 99 }),
    ];
    assert.deepEqual(contestResult(contest(), rows), { total: 4, solved: 1, pending: 1, points: 40, tookPart: true });
    assert.equal(contestResult(contest(), [rows[4], rows[5]]).tookPart, false);
  });

  it("чужие решения, которые сервер отдаёт администратору, не считаются своими", () => {
    const rows = [submission({ id: 1, student: 7 }), submission({ id: 2, student: 8 })];
    assert.deepEqual(ownSubmissions(rows, 7).map((row) => row.id), [1]);
    assert.deepEqual(ownSubmissions(rows, null), []);
  });

  it("отправляет тьютору условия и обрезает длинные", () => {
    const short = reviewPrompt(
      contest({ title: "К 1", task_details: [{ title: "Первая", condition_text: "Реши" } as Contest["task_details"][number]] }),
    );
    assert.match(short, /«К 1»/);
    assert.match(short, /1\. Первая: Реши/);
    const long = reviewPrompt(
      contest({ task_details: [{ title: "Длинная", condition_text: "я".repeat(5000) } as Contest["task_details"][number]] }),
    );
    assert.ok(long.length < 2000);
    assert.ok(long.endsWith("…"));
  });
});

describe("рейтинг", () => {
  const users = [
    user(1, 1500, { country_code: "KZ" }),
    user(2, 1800, { country_code: "RU", ratings: [{ discipline_name: "Физика", elo_score: 1300, tier_level: "LT3" }] }),
    user(3, 1500, { country_code: "KZ", ratings: [{ discipline_name: "Физика", elo_score: 1700, tier_level: "LT1" }] }),
    user(4, 1200, { country_code: "KZ", ratings: [{ discipline_name: "Химия", elo_score: 1100, tier_level: "LT4" }] }),
  ];

  it("равные баллы делят место", () => {
    const rows = buildBoard(users, { subject: null, country: null }, 3);
    assert.deepEqual(
      rows.map((row) => [row.id, row.place, row.me]),
      [
        [2, 1, false],
        [1, 2, false],
        [3, 2, true],
        [4, 4, false],
      ],
    );
  });

  it("фильтрует по стране и по предмету", () => {
    assert.deepEqual(buildBoard(users, { subject: null, country: "KZ" }, null).map((row) => row.id), [1, 3, 4]);
    const physics = buildBoard(users, { subject: "Физика", country: null }, null);
    assert.deepEqual(physics.map((row) => [row.id, row.points, row.tier]), [
      [3, 1700, "LT1"],
      [2, 1300, "LT3"],
    ]);
    assert.deepEqual(buildBoard(users, { subject: "Физика", country: "RU" }, null).map((row) => row.id), [2]);
  });

  it("находит предметы, сначала те, где людей больше", () => {
    assert.deepEqual(subjectsOf(users), ["Физика", "Химия"]);
    assert.deepEqual(subjectsOf([user(1, 1200)]), []);
  });

  it("сосед это ближайший с другими баллами, а не равный тебе", () => {
    const rows = buildBoard(users, { subject: null, country: null }, 3);
    const me = rows.find((row) => row.me)!;
    const near = neighboursOf(rows, me);
    assert.equal(near.above?.id, 2);
    assert.equal(near.below?.id, 4);
    assert.equal(shareToNext(me, near), 50);
    assert.equal(shareToNext(me, { above: near.above, below: null }), null);
  });

  it("показывает начало таблицы и ученика с соседями", () => {
    const many = Array.from({ length: 30 }, (_, index) => user(index + 1, 3000 - index * 10));
    const inTop = visibleLines(buildBoard(many, { subject: null, country: null }, 3), 10);
    assert.equal(inTop.length, 11);
    assert.deepEqual(inTop[10], { type: "gap", count: 20 });

    const far = visibleLines(buildBoard(many, { subject: null, country: null }, 20), 10);
    assert.deepEqual(far[10], { type: "gap", count: 7 });
    const near = far.slice(11, 16).map((line) => (line.type === "row" ? line.row.id : 0));
    assert.deepEqual(near, [18, 19, 20, 21, 22]);
    assert.deepEqual(far[16], { type: "gap", count: 8 });

    const last = visibleLines(buildBoard(many, { subject: null, country: null }, 30), 10);
    assert.equal(last[last.length - 1].type, "row");

    // Весь список виден, и промежутков нет.
    const all = visibleLines(buildBoard(many, { subject: null, country: null }, 30), 60);
    assert.ok(all.every((line) => line.type === "row"));
  });

  it("считает баллы за неделю только по принятым решениям", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    assert.equal(
      weeklyGain(
        [
          { status: "approved", task_points: 30, reviewed_at: "2026-11-09T00:00:00Z" },
          { status: "approved", task_points: 50, reviewed_at: "2026-10-01T00:00:00Z" },
          { status: "pending", task_points: 70, reviewed_at: null },
        ],
        now,
      ),
      30,
    );
  });
});

describe("профиль", () => {
  it("день занятий это фокус или привычка", () => {
    const activity = mergeActivity({ "2026-11-01": 600, "2026-11-02": 0 }, [
      {
        calendar: [
          { date: "2026-11-01", done: true },
          { date: "2026-11-02", done: false },
          { date: "2026-11-03", done: true },
        ],
      },
    ]);
    assert.deepEqual(Array.from(activity.keys()).sort(), ["2026-11-01", "2026-11-03"]);
    assert.deepEqual(activity.get("2026-11-01"), { seconds: 600, habit: true });
  });

  it("серия живёт до конца следующего дня", () => {
    const today = new Date(2026, 10, 5, 12);
    assert.deepEqual(streaksOf(["2026-11-03", "2026-11-04"], today), { current: 2, best: 2, total: 2 });
    assert.deepEqual(streaksOf(["2026-11-03", "2026-11-05"], today), { current: 1, best: 1, total: 2 });
    assert.deepEqual(streaksOf(["2026-10-20", "2026-10-21", "2026-10-22"], today), { current: 0, best: 3, total: 3 });
    assert.deepEqual(streaksOf([], today), { current: 0, best: 0, total: 0 });
  });

  it("серия считается через границу месяца", () => {
    const today = new Date(2026, 10, 2, 12);
    assert.equal(streaksOf(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"], today).current, 4);
  });

  it("год занятий: неделя в столбце, будущее пусто", () => {
    // 5 ноября 2026 это четверг.
    const today = new Date(2026, 10, 5, 12);
    const cells = heatCells(new Map([["2026-11-04", { seconds: 7200, habit: false }]]), today);
    assert.equal(cells.length, 52 * 7);
    const last = cells.slice(-7);
    assert.equal(last[0].key, "2026-11-02");
    assert.equal(last[2].level, 4);
    assert.equal(last[3].today, true);
    assert.deepEqual(last.slice(4).map((cell) => cell.future), [true, true, true]);
    assert.ok(last[2].title.includes("120 мин"));
  });

  it("часы по неделям: самая длинная неделя во всю высоту", () => {
    const today = new Date(2026, 10, 5, 12);
    const bars = weekBars({ "2026-11-02": 3600, "2026-10-27": 1800 }, today);
    assert.equal(bars.length, 12);
    assert.equal(bars[11].now, true);
    assert.equal(bars[11].height, 100);
    assert.equal(bars[10].height, 50);
    assert.equal(bars[0].height, 0);
    assert.ok(monthAxis(bars).length >= 2);
  });

  it("часы без данных счётчиком не считаются", () => {
    assert.equal(hoursStat(0), null);
    assert.equal(hoursStat(200), null);
    assert.deepEqual(hoursStat(9000), { value: "2,5", label: "часа в фокусе" });
    assert.deepEqual(hoursStat(3600), { value: "1", label: "час в фокусе" });
    assert.deepEqual(hoursStat(64 * 3600), { value: "64", label: "часа в фокусе" });
  });

  it("одна задача считается один раз", () => {
    const rows = solvedTasks([
      submission({ id: 1, task: 1, reviewed_at: "2026-11-01T00:00:00Z" }),
      submission({ id: 2, task: 1, reviewed_at: "2026-11-03T00:00:00Z" }),
      submission({ id: 3, task: 2, status: "rejected" }),
      submission({ id: 4, task: 3, reviewed_at: "2026-11-02T00:00:00Z" }),
    ]);
    assert.deepEqual(rows.map((row) => row.id), [2, 4]);
  });

  describe("бейджи", () => {
    const empty = { activeDays: [], daily: {}, submissions: [], contests: [], topics: [], materials: [], courses: [] };
    const earned = (input: Parameters<typeof computeBadges>[0]) =>
      computeBadges(input)
        .filter((badge) => badge.earned)
        .map((badge) => badge.key);

    it("новому ученику не выдаёт ничего", () => {
      assert.deepEqual(earned(empty), []);
    });

    it("серия из семи дней даёт значок, семь дней вразброс нет", () => {
      const run = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];
      assert.deepEqual(earned({ ...empty, activeDays: run }), ["week"]);
      const apart = run.map((key, index) => (index % 2 ? key : key.replace("2026-10", "2026-09")));
      assert.deepEqual(earned({ ...empty, activeDays: apart }), []);
    });

    it("считает дни, часы, темы, контест, баллы и материал", () => {
      const days = Array.from({ length: 30 }, (_, index) => dayKeyOf(new Date(2026, 0, 1 + index * 2)));
      assert.deepEqual(earned({ ...empty, activeDays: days }), ["month"]);
      assert.deepEqual(earned({ ...empty, daily: { "2026-10-01": 36000 } }), ["focus"]);
      const topic = { name: "Импульс", status: "SUCCESS", subject_name: "Физика", last_revised_at: null };
      assert.deepEqual(earned({ ...empty, topics: [topic] }), ["topic"]);
      assert.deepEqual(earned({ ...empty, topics: Array(5).fill(topic) }), ["topic", "topics"]);
      assert.deepEqual(earned({ ...empty, topics: [{ ...topic, archived: true }] }), []);
      assert.deepEqual(earned({ ...empty, topics: [{ ...topic, status: "MEDIUM" }] }), []);
      assert.deepEqual(
        earned({ ...empty, contests: [contest()], submissions: [submission({ task_points: 40 })] }),
        ["contest"],
      );
      assert.deepEqual(earned({ ...empty, submissions: [submission({ task: 9, task_points: 100 })] }), ["points"]);
      assert.deepEqual(
        earned({
          ...empty,
          submissions: [
            submission({ task: 9, task_points: 60, reviewed_at: "2026-10-01T00:00:00Z" }),
            submission({ task: 8, task_points: 60, reviewed_at: "2026-11-01T00:00:00Z" }),
          ],
        }),
        [],
      );
      assert.deepEqual(earned({ ...empty, materials: [{ title: "Сборник", total_units: 10, completed_units: 10 }] }), [
        "finished",
      ]);
      assert.deepEqual(earned({ ...empty, courses: [{ subject: "Физика", percent: 100 }] }), ["finished"]);
      assert.deepEqual(earned({ ...empty, courses: [{ subject: "Физика", percent: 99 }, { subject: "Химия", percent: null }] }), []);
      assert.deepEqual(earned({ ...empty, materials: [{ title: "Сборник", total_units: 10, completed_units: 9 }] }), []);
      assert.deepEqual(earned({ ...empty, materials: [{ title: "Пусто", total_units: 0, completed_units: 0 }] }), []);
    });

    it("значок темы идёт от предмета", () => {
      const glyph = (subject: string) =>
        computeBadges({
          ...empty,
          topics: [{ name: "Т", status: "SUCCESS", subject_name: subject, last_revised_at: null }],
        }).find((badge) => badge.key === "topic")?.glyph;
      assert.equal(glyph("Физика"), "F=ma");
      assert.equal(glyph("Химия"), "H₂O");
      assert.equal(glyph("Алгебра"), "x²");
    });
  });
});
