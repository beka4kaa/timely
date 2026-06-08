/**
 * Type declarations for imagetracerjs v1.2.6
 *
 * Оригинальная библиотека не поставляет типы.
 * Установка: npm install imagetracerjs
 *
 * Документация опций: node_modules/imagetracerjs/options.md
 * Доступные строковые пресеты:
 *   'default' | 'posterized1' | 'posterized2' | 'posterized3' |
 *   'curvy' | 'sharp' | 'detailed' | 'smoothed' | 'grayscale' |
 *   'fixedpalette' | 'randomsampling1' | 'randomsampling2' |
 *   'artistic1' | 'artistic2' | 'artistic3' | 'artistic4' |
 *   'blobs' | 'photo'
 */

declare module "imagetracerjs" {
  interface TracerOptions {
    /** Число цветов в палитре (1–256). По умолчанию 16. */
    numberofcolors?: number;
    /** Минимальный размер пути в пикселях. По умолчанию 8. */
    mincolorratio?: number;
    colorquantcycles?: number;
    /** Степень сглаживания путей (0–1). */
    strokewidth?: number;
    linefilter?: boolean;
    scale?: number;
    roundcoords?: number;
    viewbox?: boolean;
    desc?: boolean;
    /** Уровень сглаживания кривых. */
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    rightangleenhance?: boolean;
    [key: string]: unknown;
  }

  type TracerPreset =
    | "default"
    | "posterized1"
    | "posterized2"
    | "posterized3"
    | "curvy"
    | "sharp"
    | "detailed"
    | "smoothed"
    | "grayscale"
    | "fixedpalette"
    | "randomsampling1"
    | "randomsampling2"
    | "artistic1"
    | "artistic2"
    | "artistic3"
    | "artistic4"
    | "blobs"
    | "photo";

  interface ImageTracerInstance {
    /**
     * Загружает изображение по URL, трассирует его и вызывает callback с SVG-строкой.
     * ВАЖНО: работает только в браузере (использует <img> и Canvas API).
     */
    imageToSVG(
      url: string,
      callback: (svgString: string) => void,
      options?: TracerPreset | TracerOptions
    ): void;

    /**
     * Синхронно конвертирует ImageData в SVG-строку.
     * Используй этот метод если уже получил ImageData самостоятельно
     * (например, через Canvas API с обходом CORS).
     */
    imagedataToSVG(
      imageData: ImageData,
      options?: TracerPreset | TracerOptions
    ): string;

    /**
     * Загружает изображение по URL в Canvas и вызывает callback.
     * Для кросс-доменных URL передай options.corsenabled = true.
     */
    loadImage(
      url: string,
      callback: (canvas: HTMLCanvasElement) => void,
      options?: { corsenabled?: boolean }
    ): void;

    /** Извлекает ImageData из Canvas-элемента. */
    getImgdata(canvas: HTMLCanvasElement): ImageData;
  }

  const instance: ImageTracerInstance;
  export default instance;
}
