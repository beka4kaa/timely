import assert from "node:assert/strict";
import { test } from "node:test";

import { coverAuthor, coverClass, coverTitle } from "./curriculum-cover.ts";

test("цвет обложки берётся от предмета, регистр и форма слова не важны", () => {
  assert.equal(coverClass("Физика"), "b-phys");
  assert.equal(coverClass("физика: механика"), "b-phys");
  assert.equal(coverClass("Профильная математика"), "b-alg");
  assert.equal(coverClass("Русский язык"), "b-rus");
});

test("вторая книга того же предмета отличается от первой, третья снова основная", () => {
  assert.notEqual(coverClass("Физика", 0), coverClass("Физика", 1));
  assert.equal(coverClass("Физика", 2), coverClass("Физика", 0));
});

test("у незнакомого предмета цвет всегда один и тот же", () => {
  const first = coverClass("Шахматы");
  assert.equal(coverClass("шахматы "), first);
  assert.match(first, /^(b|cv)-/);
  assert.match(coverClass(""), /^(b|cv)-/);
});

test("на обложке название без метки времени и мусора из имени файла", () => {
  assert.equal(
    coverTitle("1741867504__-algebra_-9-klass_-abylkasymova_-2022.pdf"),
    "Algebra 9 klass abylkasymova 2022",
  );
  assert.equal(
    coverTitle("_OceanofPDF.com_Hands-On_Machine_Learning.pdf"),
    "Hands On Machine Learning",
  );
  assert.equal(coverTitle("Физика 9"), "Физика 9");
});

test("автор на обложке это одна фамилия, без инициалов", () => {
  assert.equal(coverAuthor(["Кронгарт Б. А."]), "Кронгарт");
  assert.equal(coverAuthor(["Б. А. Кронгарт"]), "Кронгарт");
  assert.equal(coverAuthor(["Б.А.Кронгарт", "Другой"]), "Кронгарт");
  assert.equal(coverAuthor(["Жанпейсова"]), "Жанпейсова");
  assert.equal(coverAuthor([]), "");
  assert.equal(coverAuthor(null), "");
  assert.equal(coverAuthor(["  "]), "");
});
