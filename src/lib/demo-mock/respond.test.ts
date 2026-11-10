import assert from "node:assert/strict"
import { test } from "node:test"

import { addDays, computeShift, mondayOf, shiftDates, shiftString } from "./dates"
import { isDemoHost } from "./host"
import { cannedStream, respondDemo, type DemoFixtures } from "./respond"

const fixtures: DemoFixtures = {
  meta: { capturedAt: "2026-11-10T04:45:00Z", timeZone: "Asia/Almaty", today: "2026-11-10", email: "aliya@demo.timely-plan.study" },
  get: {
    "B /api/me/": { status: 200, body: { name: "Алия", created_at: "2026-11-10T04:45:00Z" } },
    "B /api/habits/?today=2026-11-10": { status: 200, body: [{ title: "Читать", logs: ["2026-11-09", "2026-11-08"] }] },
    "B /api/contests/": { status: 200, body: [{ title: "Физика", start_time: "2026-11-15T10:00:00Z" }] },
    "B /api/study-commitments/": { status: 200, body: [{ title: "Волейбол", valid_from: "2026-11-09" }] },
    "A /api/topics?filter=weak": { status: 200, body: [{ title: "Векторы", next_review_at: "2026-11-10T00:00:00Z" }] },
  },
  blocks: [
    { id: "a", schedule: "s1", start_at: "2026-11-10T10:00:00Z", end_at: "2026-11-10T10:40:00Z" },
    { id: "b", schedule: "s2", start_at: "2026-11-12T10:00:00Z", end_at: "2026-11-12T10:30:00Z" },
    { id: "c", schedule: "s1", start_at: "2026-11-17T10:00:00Z", end_at: "2026-11-17T10:30:00Z" },
  ],
  diaryWeeks: {
    "2026-11-09": { weekStart: "2026-11-09", days: [{ date: "2026-11-10", dayOfWeek: "tuesday" }] },
  },
}

const get = (scope: "A" | "B", path: string, search = "") => ({ method: "GET", scope, path, search })

test("dates move by calendar days, inside values and keys", () => {
  assert.equal(addDays("2026-11-30", 2), "2026-12-02")
  assert.equal(mondayOf("2026-11-15"), "2026-11-09")
  assert.equal(shiftString("с 2026-11-10T15:00:00Z до 2026-11-11", 3), "с 2026-11-13T15:00:00Z до 2026-11-14")
  assert.deepEqual(shiftDates({ "2026-11-10": ["2026-11-09"] }, 1), { "2026-11-11": ["2026-11-10"] })
})

test("the schedule moves by whole weeks, the rest by days", () => {
  // Пятница на следующей неделе после съёмки во вторник.
  assert.deepEqual(computeShift("2026-11-10", "2026-11-20"), { days: 10, weeks: 7 })
  assert.deepEqual(computeShift("2026-11-10", "2026-11-10"), { days: 0, weeks: 0 })
})

test("the session is a made-up student and the backend token is fake", () => {
  const session = respondDemo(fixtures, get("A", "/api/auth/session"), { days: 0, weeks: 0 })
  assert.equal((session.json as { user: { name: string } }).user.name, "Алия")
  const token = respondDemo(fixtures, get("A", "/api/auth/backend-token"), { days: 0, weeks: 0 })
  assert.equal((token.json as { token: string }).token, "demo")
})

test("a habit's streak still ends yesterday on a later day", () => {
  const shift = computeShift("2026-11-10", "2026-11-13")
  const reply = respondDemo(fixtures, get("B", "/api/habits/", "?today=2026-11-13"), shift)
  assert.deepEqual(reply.json, [{ title: "Читать", logs: ["2026-11-12", "2026-11-11"] }])
})

test("unknown queries fall back to the same path", () => {
  const reply = respondDemo(fixtures, get("B", "/api/habits/", "?today=2030-01-01&x=1"), { days: 1, weeks: 0 })
  assert.equal(reply.status, 200)
  assert.ok(Array.isArray(reply.json))
})

test("study blocks keep their weekday and are filtered by the asked range", () => {
  const shift = computeShift("2026-11-10", "2026-11-19") // четверг следующей недели
  const reply = respondDemo(
    fixtures,
    get("B", "/api/learning-blocks/", "?from=2026-11-16&to=2026-11-22&timezone=Asia%2FAlmaty"),
    shift,
  )
  const ids = (reply.json as Array<{ id: string; start_at: string }>).map((b) => `${b.id}@${b.start_at.slice(0, 10)}`)
  assert.deepEqual(ids, ["a@2026-11-17", "b@2026-11-19"])
  const onlyS1 = respondDemo(fixtures, get("B", "/api/learning-blocks/", "?schedule=s1"), { days: 0, weeks: 0 })
  assert.deepEqual((onlyS1.json as Array<{ id: string }>).map((b) => b.id), ["a", "c"])
})

test("the diary returns the school week for any asked Monday", () => {
  const same = respondDemo(fixtures, get("A", "/api/diary/week", "?weekStart=2026-11-16"), { days: 7, weeks: 7 })
  assert.equal((same.json as { weekStart: string }).weekStart, "2026-11-16")
  const far = respondDemo(fixtures, get("A", "/api/diary/week", "?weekStart=2026-12-07"), { days: 0, weeks: 0 })
  assert.equal((far.json as { weekStart: string }).weekStart, "2026-12-07")
  assert.equal((far.json as { days: Array<{ date: string }> }).days[0].date, "2026-12-08")
})

test("writes look successful but change nothing, deletes are empty", () => {
  const created = respondDemo(
    fixtures,
    { method: "POST", scope: "B", path: "/api/habits/", search: "", body: JSON.stringify({ title: "Бег" }) },
    { days: 0, weeks: 0 },
  )
  assert.equal(created.status, 200)
  assert.equal((created.json as { title: string }).title, "Бег")
  const removed = respondDemo(fixtures, { method: "DELETE", scope: "B", path: "/api/habits/1/", search: "" }, { days: 0, weeks: 0 })
  assert.equal(removed.status, 204)
})

test("unknown lists are empty and unknown items are 404", () => {
  assert.deepEqual(respondDemo(fixtures, get("B", "/api/nutrition/entries/"), { days: 0, weeks: 0 }).json, [])
  assert.equal(respondDemo(fixtures, get("B", "/api/curriculum/chats/0b7c6a7e-1d2f-4a51-9c3e-5f0a1b2c3d4e/"), { days: 0, weeks: 0 }).status, 404)
})

test("the tutor answers with a canned stream in the asker's language", () => {
  const ru = cannedStream("/api/curriculum/ask/stream/", JSON.stringify({ message: "Объясни импульс" }))
  assert.equal(ru[0].event, "stage")
  assert.equal(ru[ru.length - 1].event, "done")
  const text = ru.filter((f) => f.event === "content").map((f) => f.data.delta).join("")
  assert.match(text, /^Это демо/)
  assert.equal(ru.find((f) => f.event === "content")?.data.text, ru.find((f) => f.event === "content")?.data.delta)
  const en = cannedStream("/api/curriculum/ask/stream/", JSON.stringify({ message: "Explain momentum" }))
  assert.match(en.filter((f) => f.event === "content").map((f) => f.data.delta).join(""), /^This is the demo/)
  const plan = respondDemo(
    fixtures,
    { method: "POST", scope: "B", path: "/api/studyplan/chat/stream/", search: "", body: "{}" },
    { days: 0, weeks: 0 },
  )
  assert.ok(plan.sse?.some((f) => String(f.data.text).includes("план")))
})

test("only the demo host is the demo", () => {
  assert.equal(isDemoHost("demo.timely-plan.study"), true)
  assert.equal(isDemoHost("DEMO.timely-plan.study."), true)
  assert.equal(isDemoHost("app.timely-plan.study"), false)
  assert.equal(isDemoHost(""), false)
})
