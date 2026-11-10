"use client";

// Перехват запросов на хосте демо. Подключается самым первым клиентским модулем
// (провайдер сессии), поэтому успевает раньше, чем приложение спросит сессию или
// данные. Вне хоста демо ничего не делает.
//
// Всё, что ушло бы в бэкенд или в API сайта, получает ответ из снимка
// public/demo/fixtures.json. Настоящие сервера демо не видят: ни данных, ни нагрузки.

import { BACKEND_URL } from "@/lib/api-utils";

import { computeShift, todayIn } from "./dates";
import { inDemoBrowser } from "./host";
import { respondDemo, type DemoFixtures, type DemoReply } from "./respond";

const FIXTURES_URL = "/demo/fixtures.json";

let fixtures: Promise<DemoFixtures> | null = null;

function loadFixtures(realFetch: typeof fetch): Promise<DemoFixtures> {
  fixtures ??= realFetch(FIXTURES_URL, { cache: "force-cache" }).then((response) => {
    if (!response.ok) throw new Error(`demo fixtures: HTTP ${response.status}`);
    return response.json() as Promise<DemoFixtures>;
  });
  return fixtures;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toResponse(reply: DemoReply, signal?: AbortSignal | null): Response {
  if (reply.sse) {
    const frames = reply.sse;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const frame of frames) {
          if (signal?.aborted) break;
          controller.enqueue(encoder.encode(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`));
          // Как печатает настоящий тьютор: кусками, а не всё разом.
          await sleep(frame.event === "content" ? 28 : 350);
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  if (reply.status === 204 || reply.json === undefined) return new Response(null, { status: reply.status });
  return new Response(JSON.stringify(reply.json), {
    status: reply.status,
    headers: { "Content-Type": "application/json" },
  });
}

function bodyText(body: BodyInit | null | undefined): string | null {
  return typeof body === "string" ? body : null;
}

export function installDemoFetch(): void {
  const flagged = window as unknown as { __timelyDemoFetch?: boolean };
  if (flagged.__timelyDemoFetch) return;
  flagged.__timelyDemoFetch = true;

  const realFetch = window.fetch.bind(window);
  const backendOrigin = new URL(BACKEND_URL, window.location.href).origin;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), window.location.href);
    const scope =
      url.origin === backendOrigin
        ? "B"
        : url.origin === window.location.origin && url.pathname.startsWith("/api/")
          ? "A"
          : null;
    if (!scope) return realFetch(input, init);

    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const data = await loadFixtures(realFetch);
    const shift = computeShift(data.meta.today, todayIn(data.meta.timeZone));
    const reply = respondDemo(
      data,
      { method, scope, path: url.pathname, search: url.search, body: bodyText(init?.body) },
      shift,
    );
    return toResponse(reply, init?.signal ?? request?.signal);
  };
}

if (inDemoBrowser()) installDemoFetch();
