import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import { readSse } from "./sse.ts";

/** Ответ с телом из заданных кусков — так же его режет настоящий провайдер. */
function response(...pieces: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = {
    getReader() {
      return {
        read: async () =>
          index < pieces.length
            ? { done: false, value: encoder.encode(pieces[index++]) }
            : { done: true, value: undefined },
        releaseLock() {},
      };
    },
  };
  return { body } as unknown as Response;
}

async function collect(res: Response) {
  const out: { event: string; data: Record<string, unknown> }[] = [];
  for await (const item of readSse(res)) out.push(item);
  return out;
}

test("читает события целого потока", async () => {
  const events = await collect(
    response(
      'event: stage\ndata: {"stage":"retrieving"}\n\n',
      'event: content\ndata: {"delta":"Импульс"}\n\n',
      'event: done\ndata: {"grounded":true}\n\n',
    ),
  );

  assert.deepEqual(
    events.map((e) => e.event),
    ["stage", "content", "done"],
  );
  assert.equal(events[1].data.delta, "Импульс");
});

test("кадр, разорванный между чтениями, собирается", async () => {
  // Главное свойство: провайдер режет данные по своим границам, и `data:`
  // приезжает двумя кусками. Без буфера такое событие терялось бы целиком.
  const events = await collect(
    response('event: content\ndata: {"del', 'ta":"масса"}\n\n'),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].data.delta, "масса");
});

test("несколько кадров в одном чтении", async () => {
  const events = await collect(
    response('event: a\ndata: {"n":1}\n\nevent: b\ndata: {"n":2}\n\n'),
  );

  assert.deepEqual(
    events.map((e) => e.data.n),
    [1, 2],
  );
});

test("битый кадр не рвёт поток", async () => {
  const events = await collect(
    response("event: content\ndata: не json\n\n", 'event: done\ndata: {"ok":true}\n\n'),
  );

  assert.deepEqual(
    events.map((e) => e.event),
    ["done"],
  );
});

test("кириллица в данных не портится", async () => {
  const events = await collect(
    response('event: content\ndata: {"delta":"произведение массы"}\n\n'),
  );

  assert.equal(events[0].data.delta, "произведение массы");
});

test("пустое тело даёт пустой поток", async () => {
  const events = await collect({ body: null } as unknown as Response);
  assert.deepEqual(events, []);
});

test("недочитанный хвост без пустой строки отбрасывается", async () => {
  // Соединение оборвалось посреди кадра: половинчатое событие показывать
  // нельзя, оно приедет как обрезанный текст ответа.
  const events = await collect(response('event: content\ndata: {"delta":"полов'));
  assert.deepEqual(events, []);
});
