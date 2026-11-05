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

test("предметы идут в порядке каталога", () => {
  const folders = buildChatFolders(
    [chat("a", "алгебра", 10), chat("b", "физика", 9)],
    SUBJECTS,
  );

  assert.deepEqual(
    folders.map((folder) => folder.title),
    ["Механика", "Алгебра"],
  );
});

test("группы без разговоров нет", () => {
  // Подпись, под которой ничего нет, это шум.
  assert.deepEqual(buildChatFolders([], SUBJECTS), []);

  const folders = buildChatFolders([chat("a", "физика", 10)], SUBJECTS);

  assert.deepEqual(
    folders.map((folder) => folder.title),
    ["Механика"],
  );
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

test("внутри группы свежие сверху", () => {
  const folders = buildChatFolders(
    [chat("старый", "физика", 1), chat("свежий", "физика", 11)],
    SUBJECTS,
  );

  assert.deepEqual(
    folders[0].chats.map((row) => row.id),
    ["свежий", "старый"],
  );
});

test("«Общие» идут первыми", () => {
  const folders = buildChatFolders(
    [chat("a", "физика", 10), chat("b", null, 9)],
    SUBJECTS,
  );

  assert.deepEqual(
    folders.map((folder) => folder.title),
    [NO_BOOK_FOLDER, "Механика"],
  );
  assert.equal(folders[0].goalId, null);
});

test("разговор удалённого предмета не теряется", () => {
  // Предмет мог уйти, пока ехал список. Терять переписку молча нельзя.
  const folders = buildChatFolders([chat("a", "исчезнувший", 10)], SUBJECTS);

  assert.equal(folders[0].title, NO_BOOK_FOLDER);
  assert.deepEqual(
    folders[0].chats.map((row) => row.id),
    ["a"],
  );
});

test("без предметов остаются только общие разговоры", () => {
  const folders = buildChatFolders([chat("a", null, 10)], []);

  assert.equal(folders.length, 1);
  assert.equal(folders[0].title, NO_BOOK_FOLDER);
});
