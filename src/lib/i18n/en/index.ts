// Английский словарь кабинета: по файлу на раздел, чтобы разделы переводились отдельно.
// Ключ — русская строка из кода, значение — перевод. Одинаковый ключ в двух файлах должен
// переводиться одинаково: это проверяет i18n.test.ts.

import type { Dictionary } from "../types";

import assist from "./assist";
import chat from "./chat";
import compete from "./compete";
import diary from "./diary";
import focus from "./focus";
import growth from "./growth";
import library from "./library";
import mind from "./mind";
import now from "./now";
import publicPages from "./public";
import shell from "./shell";
import week from "./week";

/** Файлы словаря по имени: тест сверяет, что одинаковые ключи переведены одинаково. */
export const EN_PARTS: Record<string, Dictionary> = {
  shell,
  public: publicPages,
  chat,
  assist,
  now,
  week,
  diary,
  focus,
  mind,
  library,
  growth,
  compete,
};

const EN: Dictionary = Object.assign({}, ...Object.values(EN_PARTS));

export default EN;
