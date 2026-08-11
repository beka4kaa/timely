import assert from "node:assert/strict";
import { test } from "node:test";

import { buildChatFolders, NO_BOOK_FOLDER } from "./chat-folders";

const SUBJECTS = [
  { goalId: "физика", title: "Механика", books: 1 },
  { goalId: "алгебра", title: "Алгебра", books: 0 },
];

function chat(id: string, goal: string | null, day: number) {
  return { id, goal, updated_at: new Date(2026, 7, day).toISOString() };
}

test("папка на каждый предмет, в порядке каталога", () => {
  const folders = buildChatFolders([], SUBJECTS);

  assert.deepEqual(
    folders.map((folder) => folder.title),
    ["Механика", "Алгебра"],
  );
});

test("пустой предмет остаётся папкой", () => {
  // Это способ начать разговор по предмету, а не мусор в списке.
  const folders = buildChatFolders([chat("a", "физика", 10)], SUBJECTS);

  assert.equal(folders[1].title, "Алгебра");
  assert.deepEqual(folders[1].chats, []);
});

test("чаты ложатся в свой предмет", () => {
  const folders = buildChatFolders(
    [chat("a", "физика", 10), chat("b", "алгебра", 9), chat("c", "физика", 8)],
    SUBJECTS,
  );

  assert.deepEqual(
    folders[0].chats.map((row) => row.id),
    ["a", "c"],
  );
  assert.deepEqual(
    folders[1].chats.map((row) => row.id),
    ["b"],
  );
});

test("внутри папки свежие сверху", () => {
  const folders = buildChatFolders(
    [chat("старый", "физика", 1), chat("свежий", "физика", 11)],
    SUBJECTS,
  );

  assert.deepEqual(
    folders[0].chats.map((row) => row.id),
    ["свежий", "старый"],
  );
});

test("«Без книги» идёт последней и только когда не пуста", () => {
  assert.equal(
    buildChatFolders([chat("a", "физика", 10)], SUBJECTS).length,
    2,
  );

  const folders = buildChatFolders(
    [chat("a", "физика", 10), chat("b", null, 9)],
    SUBJECTS,
  );

  assert.equal(folders.length, 3);
  assert.equal(folders[2].title, NO_BOOK_FOLDER);
  assert.equal(folders[2].goalId, null);
});

test("разговор удалённого предмета не теряется", () => {
  // Предмет мог уйти, пока ехал список. Терять переписку молча нельзя.
  const folders = buildChatFolders([chat("a", "исчезнувший", 10)], SUBJECTS);

  assert.equal(folders[2].title, NO_BOOK_FOLDER);
  assert.deepEqual(
    folders[2].chats.map((row) => row.id),
    ["a"],
  );
});

test("без предметов остаются только разговоры без книги", () => {
  const folders = buildChatFolders([chat("a", null, 10)], []);

  assert.equal(folders.length, 1);
  assert.equal(folders[0].title, NO_BOOK_FOLDER);
});
