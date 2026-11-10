"use client"

// Отдельная обёртка, потому что layout кабинета — серверный компонент, а там
// `ssr: false` не разрешён. Тур и плашка включаются на хосте демо (или в сборке со
// старым флагом демо); на обычном сайте чанк тура не грузится.

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"

import { inDemoBrowser } from "@/lib/demo-mock/host"
import { IS_DEMO } from "@/lib/demo-mode"

const DemoLayer = dynamic(() => import("./demo-layer").then((module) => module.DemoLayer), {
  ssr: false,
})

export function DemoMount() {
  // После монтирования: на сервере хоста не видно, и разметка не должна разойтись.
  const [on, setOn] = useState(false)
  useEffect(() => {
    setOn(IS_DEMO || inDemoBrowser())
  }, [])
  return on ? <DemoLayer /> : null
}
