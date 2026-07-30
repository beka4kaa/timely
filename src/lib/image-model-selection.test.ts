import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/components/board/chat-session-restore.logic.test.ts: без него нативный
// разбор в node не находит модуль и тест молча не запускается.
import {
  DEFAULT_IMAGE_QUALITY,
  FALLBACK_IMAGE_MODELS,
  buildImageRequestFields,
  defaultImageModelId,
  imageModelErrorMessage,
  imageModelLabel,
  resolveStoredModel,
  resolveStoredQuality,
  supportsQuality,
} from "./image-model-selection.ts";

const MODELS = FALLBACK_IMAGE_MODELS;
const SEEDREAM = "bytedance-seed/seedream-4.5";
const GPT_IMAGE_2 = "openai/gpt-5.4-image-2";

test("селектор показывает ровно две модели", () => {
  assert.equal(MODELS.length, 2);
  assert.deepEqual(
    MODELS.map((model) => model.label),
    ["Seedream 4.5", "GPT Image 2"],
  );
});

test("по умолчанию выбрана Seedream 4.5", () => {
  assert.equal(defaultImageModelId(MODELS), SEEDREAM);
  assert.equal(resolveStoredModel(null, MODELS), SEEDREAM);
});

test("выбор GPT Image 2 переживает перезагрузку", () => {
  // Ровно то, что произойдёт после reload: значение читается из localStorage
  // и должно остаться выбранным, а не сброситься на дефолт.
  assert.equal(resolveStoredModel(GPT_IMAGE_2, MODELS), GPT_IMAGE_2);
});

test("неизвестное значение localStorage сбрасывается на Seedream", () => {
  for (const junk of ["bytedance-seed/seedream-3", "", "null", "{}"]) {
    assert.equal(resolveStoredModel(junk, MODELS), SEEDREAM);
  }
});

test("модель, выпавшая из allowlist, сбрасывается на разрешённую", () => {
  // Backend сузил список (env или снятие модели с провайдера). Сохранённый
  // выбор обязан сброситься здесь, иначе он уедет в запрос и вернёт 400.
  const narrowed = MODELS.filter((model) => model.id === GPT_IMAGE_2);
  assert.equal(resolveStoredModel(SEEDREAM, narrowed), GPT_IMAGE_2);
});

test("дефолт с сервера имеет приоритет над флагом в списке", () => {
  assert.equal(resolveStoredModel(null, MODELS, GPT_IMAGE_2), GPT_IMAGE_2);
  // Но только если он вообще есть в списке — иначе это мусор.
  assert.equal(resolveStoredModel(null, MODELS, "evil/model"), SEEDREAM);
});

test("выбранная модель уходит в тело запроса", () => {
  assert.deepEqual(buildImageRequestFields(GPT_IMAGE_2, "medium", MODELS), {
    image_model: GPT_IMAGE_2,
    image_quality: "medium",
  });
});

test("quality не отправляется модели без поддержки", () => {
  // «Не отправляй неподдерживаемые параметры»: у Seedream качества нет.
  assert.deepEqual(buildImageRequestFields(SEEDREAM, "high", MODELS), {
    image_model: SEEDREAM,
  });
  assert.equal(supportsQuality(SEEDREAM, MODELS), false);
  assert.equal(supportsQuality(GPT_IMAGE_2, MODELS), true);
});

test("качество по умолчанию — medium, а не high", () => {
  // high автоматически включать нельзя: это молча дорожает каждая генерация.
  assert.equal(DEFAULT_IMAGE_QUALITY, "medium");
  assert.equal(resolveStoredQuality(null, GPT_IMAGE_2, MODELS), "medium");
  assert.equal(resolveStoredQuality("ultra", GPT_IMAGE_2, MODELS), "medium");
  assert.equal(resolveStoredQuality("high", GPT_IMAGE_2, MODELS), "high");
});

test("сохранённое качество игнорируется для модели без поддержки", () => {
  assert.equal(resolveStoredQuality("high", SEEDREAM, MODELS), "medium");
});

test("label модели показывается в loading state", () => {
  assert.equal(imageModelLabel(GPT_IMAGE_2, MODELS), "GPT Image 2");
  assert.equal(imageModelLabel(SEEDREAM, MODELS), "Seedream 4.5");
  // Неизвестный id не должен рисовать "undefined" на холсте.
  assert.equal(imageModelLabel("evil/model", MODELS), "evil/model");
});

test("ошибка называет упавшую модель и предлагает альтернативу", () => {
  assert.equal(
    imageModelErrorMessage(GPT_IMAGE_2, MODELS),
    "GPT Image 2 сейчас недоступна. Попробуйте Seedream 4.5 или повторите запрос позже.",
  );
  assert.equal(
    imageModelErrorMessage(SEEDREAM, MODELS),
    "Seedream 4.5 сейчас недоступна. Попробуйте GPT Image 2 или повторите запрос позже.",
  );
});

test("при единственной модели альтернатива не выдумывается", () => {
  const single = MODELS.filter((model) => model.id === SEEDREAM);
  assert.equal(
    imageModelErrorMessage(SEEDREAM, single),
    "Seedream 4.5 сейчас недоступна. Повторите запрос позже.",
  );
});
