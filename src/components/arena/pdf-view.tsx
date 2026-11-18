"use client";

// Просмотр PDF задачи прямо на странице. Встроенный просмотрщик браузера не годится:
// Android его в окне страницы не показывает вовсе, а Safari на iPhone показывает одну
// страницу. Поэтому страницы рисует pdf.js, и только на этой странице: библиотека большая
// и грузится, когда задачу открыли.

import { useEffect, useRef, useState } from "react";

type PdfState = "loading" | "ready" | "error";

/** Ширина, на которую уже нарисованы страницы: мелкие сдвиги не перерисовывают их. */
const REDRAW_STEP = 24;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  return pdfjs;
}

export function PdfView({ load, label }: { load: () => Promise<ArrayBuffer>; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PdfState>("loading");
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const host = box.current;
    if (!host) return;
    let cancelled = false;
    let drawnWidth = 0;
    let timer: number | undefined;
    let destroy: (() => void) | undefined;
    setState("loading");

    (async () => {
      try {
        const [pdfjs, data] = await Promise.all([loadPdfjs(), loadRef.current()]);
        if (cancelled) return;
        const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        if (cancelled) return;

        const draw = async () => {
          const width = Math.floor(host.clientWidth);
          if (!width || Math.abs(width - drawnWidth) < REDRAW_STEP) return;
          drawnWidth = width;
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          const canvases: HTMLCanvasElement[] = [];
          for (let number = 1; number <= doc.numPages; number += 1) {
            const page = await doc.getPage(number);
            if (cancelled) return;
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: (width / base.width) * ratio });
            const canvas = document.createElement("canvas");
            canvas.className = "pdf-page";
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
            canvas.setAttribute("aria-label", `${label}, страница ${number} из ${doc.numPages}`);
            canvas.setAttribute("role", "img");
            const context = canvas.getContext("2d");
            if (!context) throw new Error("no canvas");
            await page.render({ canvasContext: context, viewport }).promise;
            canvases.push(canvas);
          }
          if (cancelled) return;
          host.replaceChildren(...canvases);
          setState("ready");
        };

        await draw();
        const observer = new ResizeObserver(() => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => void draw().catch(() => undefined), 150);
        });
        observer.observe(host);
        const previous = destroy;
        destroy = () => {
          observer.disconnect();
          previous?.();
        };
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      destroy?.();
    };
  }, [attempt, label]);

  return (
    <div className="pdf-view" aria-busy={state === "loading"}>
      <div ref={box} className="pdf-pages" />
      {state === "loading" ? (
        <p className="small-note pdf-state" role="status">
          Открываю PDF…
        </p>
      ) : null}
      {state === "error" ? (
        <div className="pdf-state" role="alert">
          <p className="small-note">PDF не открылся.</p>
          <button className="btn btn-line" type="button" onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </button>
        </div>
      ) : null}
    </div>
  );
}
