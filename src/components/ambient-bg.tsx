"use client"

/**
 * Ambient page background.
 *
 * LIGHT MODE — мягкие peach→lavender→sky блобы (их пользователь любит, не трогаем).
 *
 * DARK MODE — намеренно СДЕРЖАННЫЙ, «natural / Apple», без насыщенного фиолетового
 * градиента (он читался как «ИИ-слоп»): глубокая нейтральная база, пара ОЧЕНЬ
 * десатурированных слабых свечений для объёма, виньетка по краям и тонкое
 * «плёночное зерно» — оно убивает эффект гладкого AI-градиента и даёт стеклу
 * физичную текстуру. Non-interactive, рендерится absolute внутри relative-обёртки.
 */

// Плёночное зерно: крошечный SVG-шум как data-URI. Поверх тёмной базы на низкой
// прозрачности даёт «настоящую» матовую текстуру вместо пластикового градиента.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

export function AmbientBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {/* Base */}
      <div className="absolute inset-0 bg-slate-50 dark:bg-[#08080b]" />

      {/* ── LIGHT: любимые мягкие блобы ── */}
      <div className="absolute -top-32 -left-24 h-[42rem] w-[42rem] rounded-full bg-orange-300/22 blur-[130px] dark:hidden" />
      <div className="absolute top-1/3 -right-24 h-[40rem] w-[40rem] rounded-full bg-violet-400/18 blur-[130px] dark:hidden" />
      <div className="absolute -bottom-40 left-1/4 h-[36rem] w-[36rem] rounded-full bg-sky-300/16 blur-[130px] dark:hidden" />

      {/* ── DARK: сдержанная глубина (десатурированные свечения, не «AI-фиолет») ── */}
      {/* холодное верхнее свечение — еле заметное */}
      <div className="absolute -top-44 left-1/2 hidden h-[46rem] w-[64rem] -translate-x-1/2 rounded-[50%] bg-[#172033]/40 blur-[160px] dark:block" />
      {/* тёплый якорь снизу — приглушённый, почти нейтральный */}
      <div className="absolute -bottom-52 right-[12%] hidden h-[38rem] w-[48rem] rounded-[50%] bg-[#231c2b]/35 blur-[160px] dark:block" />
      {/* виньетка: затемнение к краям для объёма */}
      <div
        className="absolute inset-0 hidden dark:block"
        style={{ background: "radial-gradient(125% 90% at 50% 0%, transparent 42%, rgba(0,0,0,0.55) 100%)" }}
      />
      {/* плёночное зерно поверх — убирает «гладкий AI-градиент» */}
      <div
        className="absolute inset-0 hidden opacity-[0.05] mix-blend-soft-light dark:block"
        style={{ backgroundImage: GRAIN, backgroundSize: "140px 140px" }}
      />
    </div>
  )
}
