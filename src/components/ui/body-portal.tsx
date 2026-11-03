"use client";

// Вынос слоя в `document.body`.
//
// `<main>` дашборда — фиксированный слой со своим z-index, а значит, и своим
// контекстом наложения: что бы ни было внутри страницы, выше рейла и нижней
// панели разделов оно не поднимется. Листы и модальные окна страниц поэтому
// живут в body — как порталы Radix.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function BodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}
