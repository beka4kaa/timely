"use client";

// Помощник поменял данные из мини-окна, а страница под ним держит свои строки в состоянии.
//
// То, что лежит в общем кэше (`resource-cache.ts`), обновляется через него. Здесь только
// страницы со своим состоянием: без сигнала ученик не увидел бы новую привычку до перезагрузки.

import { useEffect, useRef } from "react";

export type DataArea = "habits" | "goals" | "diary" | "subjects" | "timetable";

const EVENT = "timely:data-changed";

export function dataChanged(area: DataArea): void {
  window.dispatchEvent(new CustomEvent<DataArea>(EVENT, { detail: area }));
}

export function useDataChanged(area: DataArea, reload: () => void): void {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    const listen = (event: Event) => {
      if ((event as CustomEvent<DataArea>).detail === area) latest.current();
    };
    window.addEventListener(EVENT, listen);
    return () => window.removeEventListener(EVENT, listen);
  }, [area]);
}
