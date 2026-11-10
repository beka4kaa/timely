"use client"

// Тур по демо: затемнение с окном вокруг цели и стеклянная карточка рядом.
//
// Окно рисует `.tour-ring`: его огромная тень и есть затемнение, поэтому окно
// плавно переезжает от цели к цели одними CSS-переходами. Клики мимо окна ловит
// прозрачный слой с `clip-path` по тому же пути: внутри окна цель остаётся живой,
// её можно нажать.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"

import { Icon } from "@/components/shell/icons"
import { SlimeMark } from "@/components/shell/sidebar"
import { listChats } from "@/lib/curriculum-api"
import type { DemoLang } from "@/lib/demo-mode"
import { useDashboardPath } from "@/lib/use-dashboard-path"

import { DEMO_UI, TOUR_STOPS } from "./demo-copy"
import { DOCK_BELOW, holeFor, placeCard, veilPath, type Rect, type Size } from "./tour-geometry"

const FIND_TIMEOUT_MS = 8000
const SETTLE_MS = 420
/** Размер закрытого окна: оно прячется под карточкой. */
const CLOSED_RING = 40

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Первая видимая цель; части селектора проверяются по порядку, как приоритет. */
function findTarget(selector: string): HTMLElement | null {
  for (const part of selector.split(",")) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(part.trim()))
    for (const node of nodes) {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) return node
    }
  }
  return null
}

/** Высота панели вкладок снизу (на телефоне), чтобы карточка не легла на неё. */
function dockOffset(viewport: Size): number {
  const bar = document.querySelector<HTMLElement>(".tabbar")
  if (!bar) return 0
  const rect = bar.getBoundingClientRect()
  if (rect.height <= 0 || rect.top >= viewport.height) return 0
  return viewport.height - rect.top + 8
}

async function routeFor(index: number): Promise<string> {
  const stop = TOUR_STOPS[index]
  if (!stop.chatMatch) return stop.route
  try {
    const chats = await listChats()
    const needle = stop.chatMatch.toLocaleLowerCase("ru")
    const hit = chats.find((chat) => chat.title.toLocaleLowerCase("ru").includes(needle))
    if (hit) return `${stop.route}?chat=${encodeURIComponent(hit.id)}`
  } catch {
    // Без списка чатов просто откроем раздел.
  }
  return stop.route
}

export function DemoTour({
  lang,
  onLang,
  onClose,
}: {
  lang: DemoLang
  onLang: (lang: DemoLang) => void
  onClose: () => void
}) {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const path = useDashboardPath()
  const pathRef = useRef(path)
  pathRef.current = path

  const [index, setIndex] = useState(0)
  const [hole, setHole] = useState<Rect | null>(null)
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
  const [card, setCard] = useState<Size>({ width: 0, height: 0 })
  const [ready, setReady] = useState(false)

  const targetRef = useRef<HTMLElement | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const stop = TOUR_STOPS[index]
  const welcome = index === 0
  const last = index === TOUR_STOPS.length - 1

  const indexRef = useRef(index)
  indexRef.current = index

  const measure = useCallback(() => {
    const size = { width: window.innerWidth, height: window.innerHeight }
    setViewport((old) => (old.width === size.width && old.height === size.height ? old : size))
    const selector = TOUR_STOPS[indexRef.current].target
    let node = targetRef.current
    if (selector && (!node || !node.isConnected)) {
      node = findTarget(selector)
      targetRef.current = node
    }
    if (!selector || !node) {
      setHole(null)
      return
    }
    const rect = node.getBoundingClientRect()
    const next = holeFor({ top: rect.top, left: rect.left, width: rect.width, height: rect.height }, size)
    setHole((old) =>
      old &&
      Math.abs(old.top - next.top) < 0.5 &&
      Math.abs(old.left - next.left) < 0.5 &&
      Math.abs(old.width - next.width) < 0.5 &&
      Math.abs(old.height - next.height) < 0.5
        ? old
        : next,
    )
  }, [])

  // Размеры экрана сразу, чтобы первая карточка не ждала поиска цели.
  useLayoutEffect(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight })
  }, [])

  // Переход к остановке: нужный раздел, ожидание цели, прокрутка к ней.
  useEffect(() => {
    let cancelled = false
    setReady(false)
    targetRef.current = null
    const current = TOUR_STOPS[index]

    ;(async () => {
      const route = await routeFor(index)
      if (cancelled) return
      if (pathRef.current !== current.route || route !== current.route) routerRef.current.push(route)

      if (current.target) {
        const started = Date.now()
        while (!cancelled && Date.now() - started < FIND_TIMEOUT_MS) {
          // Сразу после перехода на странице ещё может стоять прежний раздел.
          const node = pathRef.current === current.route ? findTarget(current.target) : null
          if (node) {
            targetRef.current = node
            const narrow = window.innerWidth <= DOCK_BELOW
            node.scrollIntoView({
              block: narrow ? "start" : "center",
              behavior: reducedMotion() ? "auto" : "smooth",
            })
            break
          }
          await sleep(120)
        }
        if (!cancelled && !reducedMotion()) await sleep(SETTLE_MS)
      }
      if (cancelled) return
      measure()
      setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [index, measure])

  // Окно едет за целью при прокрутке, смене размеров и перерисовке страницы.
  useEffect(() => {
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, { capture: true, passive: true })
    const observer = new ResizeObserver(schedule)
    if (targetRef.current) observer.observe(targetRef.current)
    const timer = window.setInterval(schedule, 600)
    return () => {
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, { capture: true })
      observer.disconnect()
      window.clearInterval(timer)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [measure, ready])

  // Размер карточки нужен, чтобы решить, под целью она встанет или над ней.
  const hasViewport = viewport.width > 0
  useLayoutEffect(() => {
    const node = cardRef.current
    if (!node) return
    const read = () => {
      const rect = node.getBoundingClientRect()
      setCard((old) =>
        Math.abs(old.width - rect.width) < 1 && Math.abs(old.height - rect.height) < 1
          ? old
          : { width: rect.width, height: rect.height },
      )
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
    // Карточки нет, пока не прочитан экран: замер должен повториться, когда она появится.
  }, [index, lang, hasViewport])

  const next = useCallback(() => {
    setIndex((value) => Math.min(value + 1, TOUR_STOPS.length - 1))
  }, [])
  const back = useCallback(() => {
    setIndex((value) => Math.max(value - 1, 0))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Cmd/Alt со стрелками — «назад» и «вперёд» браузера, их не перехватываем.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      } else if (!typing && event.key === "ArrowRight") {
        event.preventDefault()
        if (last) onClose()
        else next()
      } else if (!typing && event.key === "ArrowLeft") {
        event.preventDefault()
        back()
      } else if (
        event.key === "Enter" &&
        // Enter листает, только когда фокус на самой карточке: на ссылке или кнопке
        // страницы он должен делать своё.
        (event.target === cardRef.current || event.target === document.body)
      ) {
        event.preventDefault()
        if (last) onClose()
        else next()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [back, last, next, onClose])

  // Фокус на карточку, а не на кнопку: у кнопки была бы рамка фокуса после клика мышью.
  // Листают стрелки и Enter, кнопки доступны по Tab.
  useEffect(() => {
    if (ready) cardRef.current?.focus({ preventScroll: true })
  }, [ready, index])

  // Первый кадр: размеры экрана ещё не прочитаны.
  if (typeof document === "undefined" || viewport.width === 0) return null

  const shownHole = ready && !welcome ? hole : null
  const spot = placeCard(shownHole, card, viewport, dockOffset(viewport))
  // Без цели окно сжимается под карточку, и экран затемнён целиком. Совсем в точку
  // нельзя: у крошечного блока Chrome не рисует тень, а затемнение и есть его тень.
  const cardWidth = spot.placement === "dock" ? viewport.width - 32 : card.width
  const ring = shownHole ?? {
    top: spot.top + card.height / 2 - CLOSED_RING / 2,
    left: spot.left + cardWidth / 2 - CLOSED_RING / 2,
    width: CLOSED_RING,
    height: CLOSED_RING,
  }
  const steps = TOUR_STOPS.length - 1

  return createPortal(
    <div className="tour" data-ready={ready ? "true" : "false"} data-placement={spot.placement} lang={lang}>
      <div
        className="tour-block"
        aria-hidden="true"
        style={{ clipPath: `path(evenodd, "${veilPath(shownHole, viewport)}")` }}
      />
      <div
        className={shownHole ? "tour-ring" : "tour-ring is-closed"}
        aria-hidden="true"
        style={{ top: ring.top, left: ring.left, width: ring.width, height: ring.height }}
      />
      <div
        ref={cardRef}
        tabIndex={-1}
        className={welcome ? "tour-card glass is-welcome" : "tour-card glass"}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={
          spot.placement === "dock"
            ? { top: spot.top }
            : { top: spot.top, left: spot.left }
        }
      >
        <div className="tour-head">
          <SlimeMark size={welcome ? 44 : 26} />
          {welcome ? null : (
            <span className="tour-count">
              {index} {DEMO_UI.of[lang]} {steps}
            </span>
          )}
          <button
            type="button"
            className="btn btn-text tour-lang"
            onClick={() => onLang(lang === "en" ? "ru" : "en")}
          >
            {DEMO_UI.lang[lang]}
          </button>
          <button
            type="button"
            className="icon-btn tour-x"
            aria-label={DEMO_UI.close[lang]}
            title={DEMO_UI.close[lang]}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>

        <h2 id="tour-title" className="tour-title">
          {stop.title[lang]}
        </h2>
        <p id="tour-body" className="tour-body">
          {stop.body[lang]}
        </p>

        {welcome ? (
          <div className="tour-foot">
            <button type="button" className="btn btn-text" onClick={onClose}>
              {DEMO_UI.skip[lang]}
            </button>
            <button type="button" className="btn btn-main" onClick={next}>
              {DEMO_UI.start[lang]}
            </button>
          </div>
        ) : (
          <div className="tour-foot">
            <span className="tour-dots" aria-hidden="true">
              {TOUR_STOPS.slice(1).map((item, at) => (
                <span key={item.id} className={at + 1 === index ? "is-on" : at + 1 < index ? "is-past" : undefined} />
              ))}
            </span>
            <button type="button" className="btn btn-text" onClick={back}>
              {DEMO_UI.back[lang]}
            </button>
            <button type="button" className="btn btn-main" onClick={last ? onClose : next}>
              {last ? DEMO_UI.finish[lang] : DEMO_UI.next[lang]}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
