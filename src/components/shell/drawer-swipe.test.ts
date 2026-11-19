import assert from "node:assert/strict";
import { test } from "node:test";

import { isCloseSwipe, isOpenSwipe, linkClosesDrawer, nodeBlocksOpenSwipe } from "./drawer-swipe.ts";

test("открывает свайп вправо, начатый не у самого края", () => {
  assert.equal(isOpenSwipe({ x0: 40, y0: 300, x1: 140, y1: 310, ms: 250 }), true);
  assert.equal(isOpenSwipe({ x0: 8, y0: 300, x1: 140, y1: 310, ms: 250 }), false); // системное «назад»
  assert.equal(isOpenSwipe({ x0: 40, y0: 300, x1: 90, y1: 300, ms: 250 }), false); // коротко
  assert.equal(isOpenSwipe({ x0: 40, y0: 300, x1: 140, y1: 420, ms: 250 }), false); // это прокрутка
  assert.equal(isOpenSwipe({ x0: 40, y0: 300, x1: 140, y1: 300, ms: 900 }), false); // медленно, это не жест
});

test("закрывает свайп влево", () => {
  assert.equal(isCloseSwipe({ x0: 260, y0: 300, x1: 180, y1: 305, ms: 200 }), true);
  assert.equal(isCloseSwipe({ x0: 260, y0: 300, x1: 240, y1: 305, ms: 200 }), false);
  assert.equal(isCloseSwipe({ x0: 260, y0: 300, x1: 180, y1: 420, ms: 200 }), false);
});

const plain = { overflowX: "visible", touchAction: "auto", scrollable: false, role: null, noSwipe: false };

test("не открывает меню над тем, что само тянется вбок", () => {
  assert.equal(nodeBlocksOpenSwipe(plain), false);
  assert.equal(nodeBlocksOpenSwipe({ ...plain, touchAction: "manipulation" }), false); // обычная кнопка
  assert.equal(nodeBlocksOpenSwipe({ ...plain, role: "slider" }), true); // ползунок уровня
  assert.equal(nodeBlocksOpenSwipe({ ...plain, touchAction: "none" }), true); // слайм тянут пальцем
  assert.equal(nodeBlocksOpenSwipe({ ...plain, touchAction: "pan-y" }), true); // жест вбок у самого элемента
  assert.equal(nodeBlocksOpenSwipe({ ...plain, touchAction: "pan-x pan-y" }), false);
  assert.equal(nodeBlocksOpenSwipe({ ...plain, noSwipe: true }), true);
  assert.equal(nodeBlocksOpenSwipe({ ...plain, overflowX: "auto", scrollable: true }), true); // неделя, год
  assert.equal(nodeBlocksOpenSwipe({ ...plain, overflowX: "auto", scrollable: false }), false); // прокрутке нечего крутить
});

test("нажатие на ссылку в меню закрывает его, кроме «Тьютора» в чате", () => {
  assert.equal(linkClosesDrawer("/dashboard", "now"), true); // текущая страница: адрес не меняется
  assert.equal(linkClosesDrawer("/dashboard/goals", "now"), true);
  assert.equal(linkClosesDrawer("/dashboard/chat", "chat"), false); // открывает список чатов в меню
  assert.equal(linkClosesDrawer("/dashboard/chat", "now"), true);
  assert.equal(linkClosesDrawer(null, "now"), false);
});
