"use client"

// Отдельная обёртка, потому что layout кабинета — серверный компонент, а там
// `ssr: false` не разрешён. Вне демо этот файл не рендерится, и чанк тура не грузится.

import dynamic from "next/dynamic"

const DemoLayer = dynamic(() => import("./demo-layer").then((module) => module.DemoLayer), {
  ssr: false,
})

export function DemoMount() {
  return <DemoLayer />
}
