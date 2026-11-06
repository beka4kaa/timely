import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contextPercent,
  contextUsed,
  costLabel,
  countLabel,
  lastUsage,
  renamedModelKey,
  shortCount,
  usageLine,
  type AskUsage,
} from "./chat-usage.ts";

const USAGE: AskUsage = {
  model: "glm-5.3",
  model_name: "GLM 5.3",
  reasoning: "low",
  input_tokens: 3214,
  cached_input_tokens: 1000,
  output_tokens: 412,
  reasoning_tokens: 96,
  total_tokens: 3626,
  context_window: 1_048_576,
  cost_usd: 0.0008,
  cost_estimated: false,
};

test("у ответа с инструментами окно занято последним кругом, а не суммой", () => {
  assert.equal(contextUsed({ ...USAGE, input_tokens: 9000, context_tokens: 4100 }), 4100);
  assert.equal(contextUsed(USAGE), 3214 + 412 - 96);
});

test("старый ключ модели из браузера становится новым", () => {
  assert.equal(renamedModelKey("glm-5.3"), "smart");
  assert.equal(renamedModelKey("glm-5.3-flash"), "fast");
  assert.equal(renamedModelKey("fast"), "fast");
  assert.equal(renamedModelKey(""), "");
});

test("старые записи в истории чата показывают новые подписи", () => {
  assert.match(usageLine({ ...USAGE, model_name: "GLM 5.3 Flash" }), /^Быстрая, /);
  assert.match(usageLine({ ...USAGE, model_name: "GLM 5.3" }), /^Умная, /);
  assert.match(usageLine({ ...USAGE, model_name: "Быстрая" }), /^Быстрая, /);
});

test("числа читаются глазами", () => {
  assert.equal(countLabel(412), "412");
  assert.equal(countLabel(3214), "3 214");
  assert.equal(countLabel(1048576), "1 048 576");
  assert.equal(shortCount(950), "950");
  assert.equal(shortCount(3214), "3,2 тыс.");
  assert.equal(shortCount(1048576), "1 млн");
});

test("цена не превращается в ноль на дешёвом ответе", () => {
  assert.equal(costLabel(0.0008), "$0,0008");
  assert.equal(costLabel(0.00001), "меньше $0,0001");
  assert.equal(costLabel(0.25), "$0,250");
  assert.equal(costLabel(1.47), "$1,47");
});

test("раздумья не занимают окно следующего запроса", () => {
  assert.equal(contextUsed(USAGE), 3214 + 412 - 96);
  assert.ok(contextPercent(USAGE) < 1);
  assert.equal(contextPercent({ ...USAGE, context_window: 0 }), 0);
  assert.equal(contextPercent({ ...USAGE, input_tokens: 9_000_000 }), 100);
});

test("строка под ответом: только то, что есть", () => {
  assert.equal(
    usageLine(USAGE),
    "Умная, рассуждение низкое: вход 3 214, выход 412, из них рассуждение 96, из кэша 1 000, $0,0008",
  );
  assert.equal(
    usageLine({ ...USAGE, reasoning_tokens: 0, cached_input_tokens: 0, cost_estimated: true, reasoning: "max" }),
    "Умная, рассуждение максимальное: вход 3 214, выход 412, примерно $0,0008",
  );
});

test("окно берётся у последнего ответа с расходом", () => {
  assert.equal(lastUsage([]), null);
  assert.equal(lastUsage([{}, { usage: USAGE }, {}]), USAGE);
});
