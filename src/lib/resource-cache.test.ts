import assert from "node:assert/strict";
import { test } from "node:test";

import { invalidateResources, loadResource, readResource } from "./resource-cache.ts";

const TTL = 60_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Дать доиграть промисам, которые уже ничего не ждут. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

// ─────────────────────────── Кэш как он есть ─────────────────────────────────

test("параллельные загрузки делят один запрос", async () => {
  let calls = 0;
  const reply = deferred<string>();
  const fetcher = () => {
    calls += 1;
    return reply.promise;
  };
  const first = loadResource("dedup", fetcher, TTL);
  const second = loadResource("dedup", fetcher, TTL);
  assert.equal(first, second);
  reply.resolve("ok");
  await first;
  assert.equal(calls, 1);
  assert.equal(readResource("dedup").data, "ok");
});

test("свежее не запрашивается, а старше срока или с force — запрашивается", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls;
  };
  await loadResource("ttl", fetcher, TTL);
  await loadResource("ttl", fetcher, TTL);
  assert.equal(calls, 1);
  await loadResource("ttl", fetcher, 0);
  assert.equal(calls, 2);
  await loadResource("ttl", fetcher, TTL, true);
  assert.equal(calls, 3);
  assert.equal(readResource("ttl").data, 3);
});

test("первая загрузка показывает «загружается», фоновая — нет", async () => {
  const first = deferred<string>();
  const loading = loadResource("loading", () => first.promise, TTL);
  assert.equal(readResource("loading").loading, true);
  first.resolve("a");
  await loading;
  assert.equal(readResource("loading").loading, false);

  const second = deferred<string>();
  const background = loadResource("loading", () => second.promise, TTL, true);
  assert.equal(readResource("loading").loading, false);
  second.resolve("b");
  await background;
});

test("падение оставляет прежние данные и считается подряд, удача сбрасывает счёт", async () => {
  await loadResource("fail", async () => "old", TTL);
  const loadedAt = readResource("fail").loadedAt;

  const boom = async () => {
    throw new Error("нет связи");
  };
  await loadResource("fail", boom, TTL, true);
  await loadResource("fail", boom, TTL, true);
  let state = readResource("fail");
  assert.equal(state.data, "old");
  assert.equal(state.error, "нет связи");
  assert.equal(state.failures, 2);
  assert.ok(state.failedAt > 0);
  assert.equal(state.loadedAt, loadedAt);

  await loadResource("fail", async () => "new", TTL, true);
  state = readResource("fail");
  assert.equal(state.data, "new");
  assert.equal(state.error, null);
  assert.equal(state.failures, 0);
  assert.equal(state.failedAt, 0);
});

test("неизвестный ключ читается как пустой ресурс", () => {
  const state = readResource("nobody-loaded-this");
  assert.equal(state.data, undefined);
  assert.equal(state.loadedAt, 0);
  assert.equal(state.generation, 0);
});

// ───────────────────── Изменение во время идущего запроса ────────────────────

test("ответ на запрос, ушедший до изменения, не считается свежим", async () => {
  await loadResource("race", async () => "before", TTL);

  const poll = deferred<string>();
  void loadResource("race", () => poll.promise, TTL, true);
  invalidateResources("race");

  // Перезагрузка не присоединяется к старому запросу, а начинает новый.
  let calls = 0;
  const reply = deferred<string>();
  const reload = loadResource(
    "race",
    () => {
      calls += 1;
      return reply.promise;
    },
    TTL,
  );
  assert.equal(calls, 1);

  poll.resolve("old response");
  await settle();
  assert.equal(readResource("race").data, "before");
  assert.equal(readResource("race").loadedAt, 0);

  reply.resolve("after");
  await reload;
  assert.equal(readResource("race").data, "after");
  assert.ok(readResource("race").loadedAt > 0);
});

test("старый ответ, пришедший последним, не затирает новый", async () => {
  await loadResource("late", async () => "before", TTL);

  const poll = deferred<string>();
  void loadResource("late", () => poll.promise, TTL, true);
  invalidateResources("late");
  void loadResource("late", async () => "after", TTL);
  await settle();
  assert.equal(readResource("late").data, "after");
  const { loadedAt } = readResource("late");

  poll.resolve("old response");
  await settle();
  assert.equal(readResource("late").data, "after");
  assert.equal(readResource("late").loadedAt, loadedAt);
});

test("падение старого запроса — не падение: паузы и ошибки не появляются", async () => {
  await loadResource("old-failure", async () => "before", TTL);

  const poll = deferred<string>();
  void loadResource("old-failure", () => poll.promise, TTL, true);
  invalidateResources("old-failure");

  poll.reject(new Error("старая ошибка"));
  await settle();
  const state = readResource("old-failure");
  assert.equal(state.error, null);
  assert.equal(state.failures, 0);
  assert.equal(state.failedAt, 0);
});

test("старый ответ не отвязывает новый запрос: параллельные всё ещё делят его", async () => {
  await loadResource("share", async () => "before", TTL);

  const poll = deferred<string>();
  void loadResource("share", () => poll.promise, TTL, true);
  invalidateResources("share");

  const reply = deferred<string>();
  const reload = loadResource("share", () => reply.promise, TTL);
  poll.resolve("old response");
  await settle();

  let extra = 0;
  const joined = loadResource(
    "share",
    async () => {
      extra += 1;
      return "extra";
    },
    TTL,
  );
  assert.equal(joined, reload);
  assert.equal(extra, 0);

  reply.resolve("after");
  await reload;
  assert.equal(readResource("share").data, "after");
});

test("изменение во время первой загрузки: данные придут только с новым запросом", async () => {
  const first = deferred<string>();
  void loadResource("first", () => first.promise, TTL);
  invalidateResources("first");

  const reply = deferred<string>();
  const reload = loadResource("first", () => reply.promise, TTL);
  first.resolve("old response");
  await settle();
  assert.equal(readResource("first").data, undefined);
  assert.equal(readResource("first").loading, true);

  reply.resolve("after");
  await reload;
  assert.equal(readResource("first").data, "after");
  assert.equal(readResource("first").loading, false);
});

test("после второго изменения подряд считается только последний запрос", async () => {
  await loadResource("twice", async () => "before", TTL);

  const a = deferred<string>();
  void loadResource("twice", () => a.promise, TTL, true);
  invalidateResources("twice");
  const b = deferred<string>();
  void loadResource("twice", () => b.promise, TTL);
  invalidateResources("twice");
  const c = deferred<string>();
  void loadResource("twice", () => c.promise, TTL);

  c.resolve("c");
  await settle();
  a.resolve("a");
  b.resolve("b");
  await settle();
  assert.equal(readResource("twice").data, "c");
});

// ────────────────────────────── Устаревание ──────────────────────────────────

test("устаревшее перечитывается, хотя срок свежести не вышел", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls;
  };
  await loadResource("stale", fetcher, TTL);
  invalidateResources("stale");
  assert.equal(readResource("stale").loadedAt, 0);
  assert.equal(readResource("stale").data, 1);
  await loadResource("stale", fetcher, TTL);
  assert.equal(calls, 2);
  assert.equal(readResource("stale").data, 2);
});

// `useResource` перезагружает то, что на экране, когда меняется `generation`.
// `loadedAt` для этого не годится: у упавшего или ещё грузящегося ресурса он и
// так 0, и второе подряд изменение прошло бы незамеченным.
test("каждое изменение заметно, даже если ресурс и так считался устаревшим", async () => {
  const { generation } = readResource("again");
  await loadResource("again", async () => "a", TTL);
  invalidateResources("again");
  const once = readResource("again").generation;
  assert.equal(readResource("again").loadedAt, 0);
  invalidateResources("again");
  const twice = readResource("again").generation;
  assert.equal(readResource("again").loadedAt, 0);
  assert.ok(once > generation);
  assert.ok(twice > once);
});

test("изменение начинает отсчёт пауз заново: это новый повод перечитать", async () => {
  await loadResource("backoff", async () => "a", TTL);
  const boom = async () => {
    throw new Error("нет связи");
  };
  await loadResource("backoff", boom, TTL, true);
  await loadResource("backoff", boom, TTL, true);
  assert.equal(readResource("backoff").failures, 2);

  invalidateResources("backoff");
  assert.equal(readResource("backoff").failures, 0);
  await loadResource("backoff", boom, TTL);
  assert.equal(readResource("backoff").failures, 1);
});

test("префикс задевает только свои ключи", async () => {
  await loadResource("group:a", async () => "a", TTL);
  await loadResource("group:b", async () => "b", TTL);
  await loadResource("other", async () => "c", TTL);
  invalidateResources("group:");
  assert.equal(readResource("group:a").loadedAt, 0);
  assert.equal(readResource("group:b").loadedAt, 0);
  assert.ok(readResource("other").loadedAt > 0);
  assert.equal(readResource("other").generation, 0);
});

// ─────────────────────────────── Правка данных ───────────────────────────────

test("правка убирает ответ из полученного сразу и по всем ключам префикса", async () => {
  await loadResource("list:1", async () => ["a", "b"], TTL);
  await loadResource("list:2", async () => ["a", "c"], TTL);
  await loadResource("unrelated", async () => ["a"], TTL);

  invalidateResources<string[]>("list:", (list) => list.filter((item) => item !== "a"));

  assert.deepEqual(readResource("list:1").data, ["b"]);
  assert.deepEqual(readResource("list:2").data, ["c"]);
  assert.deepEqual(readResource("unrelated").data, ["a"]);
  assert.equal(readResource("list:1").loadedAt, 0);
});

test("правка не трогает ресурс без данных", () => {
  const first = deferred<string[]>();
  void loadResource("patch-empty", () => first.promise, TTL);
  let patched = 0;
  invalidateResources<string[]>("patch-empty", (list) => {
    patched += 1;
    return list;
  });
  assert.equal(patched, 0);
  assert.equal(readResource("patch-empty").data, undefined);
});

test("правка переживает упавшую перезагрузку", async () => {
  await loadResource("answered", async () => ["open", "answered"], TTL);
  invalidateResources<string[]>("answered", (list) => list.filter((item) => item !== "answered"));

  await loadResource(
    "answered",
    async () => {
      throw new Error("нет связи");
    },
    TTL,
  );
  const state = readResource("answered");
  assert.deepEqual(state.data, ["open"]);
  assert.equal(state.error, "нет связи");
  assert.equal(state.loadedAt, 0);
  assert.equal(state.failures, 1);
});

test("правку не отменяет старый ответ, который ещё в пути", async () => {
  await loadResource("patched-race", async () => ["open", "answered"], TTL);

  const poll = deferred<string[]>();
  void loadResource("patched-race", () => poll.promise, TTL, true);
  invalidateResources<string[]>("patched-race", (list) =>
    list.filter((item) => item !== "answered"),
  );

  poll.resolve(["open", "answered"]);
  await settle();
  assert.deepEqual(readResource("patched-race").data, ["open"]);
});
