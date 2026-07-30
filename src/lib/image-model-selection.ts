/**
 * Выбор модели генерации изображений: чистая логика без React и без DOM.
 *
 * Вынесено из ai-chat.tsx намеренно. Здесь живёт всё, что может тихо сломаться
 * и чего не видно глазами: сверка сохранённого значения с allowlist, сборка
 * полей запроса и решение, показывать ли селектор качества. В компоненте
 * остаётся только рендер и состояние.
 *
 * Источник истины — backend (`GET /api/ai/image-models/`). Локальный список
 * ниже нужен лишь для первого кадра и оффлайна; пришедший с сервера ответ его
 * заменяет.
 */

export const IMAGE_MODEL_STORAGE_KEY = "timely.board.imageModel";
export const IMAGE_QUALITY_STORAGE_KEY = "timely.board.imageQuality";

export const IMAGE_QUALITIES = ["low", "medium", "high"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

/** Дефолт намеренно не "high": он молча удорожает каждую генерацию. */
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "medium";

export interface ImageModelInfo {
  id: string;
  label: string;
  provider: string;
  description: string;
  default: boolean;
  supports_image_input: boolean;
  supports_quality: boolean;
}

export interface ImageModelsResponse {
  models: ImageModelInfo[];
  default_model: string;
}

/**
 * Список для первого кадра. Должен совпадать с
 * `backend/ai_engine/image_models.py`: расхождение проявится только тем, что
 * до ответа сервера в селекторе будет чужая подпись.
 */
export const FALLBACK_IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: "bytedance-seed/seedream-4.5",
    label: "Seedream 4.5",
    provider: "ByteDance",
    description: "Быстрая и недорогая генерация",
    default: true,
    supports_image_input: true,
    supports_quality: false,
  },
  {
    id: "openai/gpt-5.4-image-2",
    label: "GPT Image 2",
    provider: "OpenAI",
    description: "Более точная генерация сложных схем",
    default: false,
    supports_image_input: true,
    supports_quality: true,
  },
];

export const QUALITY_OPTIONS: { id: ImageQuality; label: string; description: string }[] = [
  { id: "low", label: "Low", description: "быстрее и дешевле" },
  { id: "medium", label: "Medium", description: "рекомендуется" },
  { id: "high", label: "High", description: "лучше для финального результата" },
];

export function findImageModel(
  id: string | null | undefined,
  models: ImageModelInfo[],
): ImageModelInfo | undefined {
  return models.find((model) => model.id === id);
}

export function defaultImageModelId(models: ImageModelInfo[]): string {
  if (models.length === 0) return FALLBACK_IMAGE_MODELS[0].id;
  return (models.find((model) => model.default) ?? models[0]).id;
}

/**
 * Сохранённый выбор → допустимый выбор.
 *
 * Модель могла выпасть из allowlist (убрали из env, сняли с провайдера) — тогда
 * значение из localStorage обязано СБРОСИТЬСЯ на дефолт. Иначе оно уедет в
 * запрос и вернётся 400 на каждой генерации, а причина будет не видна.
 */
export function resolveStoredModel(
  stored: string | null | undefined,
  models: ImageModelInfo[],
  defaultId?: string,
): string {
  const fallback = defaultId && findImageModel(defaultId, models)
    ? defaultId
    : defaultImageModelId(models);
  return findImageModel(stored, models) ? (stored as string) : fallback;
}

/** Качество приводится к допустимому; для модели без поддержки его нет вовсе. */
export function resolveStoredQuality(
  stored: string | null | undefined,
  modelId: string,
  models: ImageModelInfo[],
): ImageQuality {
  if (!supportsQuality(modelId, models)) return DEFAULT_IMAGE_QUALITY;
  return IMAGE_QUALITIES.includes(stored as ImageQuality)
    ? (stored as ImageQuality)
    : DEFAULT_IMAGE_QUALITY;
}

export function supportsQuality(modelId: string, models: ImageModelInfo[]): boolean {
  return Boolean(findImageModel(modelId, models)?.supports_quality);
}

/**
 * Поля модели для тела запроса генерации.
 *
 * Одна функция на ВСЕ вызовы (обычная генерация, отложенная догрузка, рестайл,
 * повтор): раньше style/palette дублировались по местам вызова, и достаточно
 * пропустить одно, чтобы выбор молча терялся именно на этом пути.
 */
export function buildImageRequestFields(
  modelId: string,
  quality: ImageQuality,
  models: ImageModelInfo[],
): { image_model: string; image_quality?: ImageQuality } {
  if (!supportsQuality(modelId, models)) return { image_model: modelId };
  return { image_model: modelId, image_quality: quality };
}

/** Человеческое имя модели — для «Генерирую через …» и текста ошибки. */
export function imageModelLabel(modelId: string, models: ImageModelInfo[]): string {
  return findImageModel(modelId, models)?.label ?? modelId;
}

/**
 * Сообщение, когда генерация не удалась.
 *
 * Автоматически переключать модель нельзя: пользователь сравнивает их вручную,
 * и молчаливая подмена сделала бы сравнение бессмысленным. Поэтому мы называем
 * упавшую модель и ПРЕДЛАГАЕМ альтернативу, а решение оставляем за ним.
 */
export function imageModelErrorMessage(
  modelId: string,
  models: ImageModelInfo[],
): string {
  const failed = imageModelLabel(modelId, models);
  const alternative = models.find((model) => model.id !== modelId);
  if (!alternative) {
    return `${failed} сейчас недоступна. Повторите запрос позже.`;
  }
  return `${failed} сейчас недоступна. Попробуйте ${alternative.label} или повторите запрос позже.`;
}
