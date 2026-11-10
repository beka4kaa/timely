"use client"

// Всё демо поверх кабинета: плашка «Демо», тур и освежение данных на новый день.

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { startDemo } from "@/lib/demo-api"
import type { DemoLang } from "@/lib/demo-mode"

import { DEMO_UI } from "./demo-copy"
import { DEMO_FRESH_KEY, DEMO_LANG_KEY, readStore, savedDemoLang, todayKey, writeStore } from "./demo-store"
import { DemoTour } from "./demo-tour"

export function DemoLayer() {
  const [lang, setLang] = useState<DemoLang>("en")
  const [open, setOpen] = useState(false)
  // Плашка живёт в левой панели над профилем: там она не закрывает ни одну страницу.
  const [sidebar, setSidebar] = useState<HTMLElement | null>(null)
  // Кнопка, которой открыли тур: после закрытия фокус возвращается на неё.
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setSidebar(document.querySelector<HTMLElement>(".sidebar"))
  }, [])

  useEffect(() => {
    setLang(savedDemoLang())
    // Флаг тура ставит страница входа. Убираем его сразу, чтобы перезагрузка не
    // начинала тур заново.
    const params = new URLSearchParams(window.location.search)
    if (params.get("tour") !== "1") return
    params.delete("tour")
    const rest = params.toString()
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`,
    )
    setOpen(true)
  }, [])

  // Вернувшийся гость: вчерашний «сейчас» уже в прошлом, данные собираются заново.
  useEffect(() => {
    const today = todayKey()
    if (readStore("session", DEMO_FRESH_KEY) === today) return
    let alive = true
    startDemo()
      .then((result) => {
        writeStore("session", DEMO_FRESH_KEY, today)
        if (alive && result.seeded) window.location.reload()
      })
      .catch(() => {
        // Демо-сервер не ответил: страница покажет свои ошибки, а мы попробуем в
        // следующий раз.
      })
    return () => {
      alive = false
    }
  }, [])

  const changeLang = useCallback((next: DemoLang) => {
    setLang(next)
    writeStore("local", DEMO_LANG_KEY, next)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    const button = opener.current
    opener.current = null
    if (button?.isConnected) window.setTimeout(() => button.focus({ preventScroll: true }), 0)
  }, [])

  const badge = (place: "sidebar" | "float") => (
    <div
      className={place === "sidebar" ? "demo-sb" : "demo-pill glass"}
      role="note"
      lang={lang}
      title={DEMO_UI.demoNote[lang]}
    >
      <span className="demo-pill-tag">{DEMO_UI.demo[lang]}</span>
      <button
        type="button"
        className="demo-pill-btn"
        onClick={(event) => {
          opener.current = event.currentTarget
          setOpen(true)
        }}
        aria-pressed={open}
      >
        {DEMO_UI.tour[lang]}
      </button>
    </div>
  )

  return (
    <>
      {sidebar ? createPortal(badge("sidebar"), sidebar) : null}
      {/* На телефоне панели нет: там только кнопка «Тур» внизу. Во время тура она не нужна. */}
      {open ? null : badge("float")}
      {open ? <DemoTour lang={lang} onLang={changeLang} onClose={close} /> : null}
    </>
  )
}
