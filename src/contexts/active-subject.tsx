"use client";

// Какой предмет открыт сейчас.
//
// Панель вопросов живёт в layout'е и висит на всех страницах, но предмет есть
// не везде: на дневнике и привычках его нет вовсе. Поэтому страницы предмета
// и плана сообщают свой goalId сюда, а панель его подхватывает; на остальных
// страницах остаётся последний выбор ученика.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface ActiveSubjectValue {
  /** Предмет, о котором идёт речь на текущей странице. `null` — страница не про предмет. */
  goalId: string | null;
  /** Сообщить предмет страницы. Возвращает функцию отмены для размонтирования. */
  setPageSubject: (goalId: string | null) => void;
}

const ActiveSubjectContext = createContext<ActiveSubjectValue>({
  goalId: null,
  setPageSubject: () => {},
});

export function ActiveSubjectProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [goalId, setGoalId] = useState<string | null>(null);
  const setPageSubject = useCallback((next: string | null) => setGoalId(next), []);
  const value = useMemo(
    () => ({ goalId, setPageSubject }),
    [goalId, setPageSubject],
  );

  return (
    <ActiveSubjectContext.Provider value={value}>
      {children}
    </ActiveSubjectContext.Provider>
  );
}

export function useActiveSubject() {
  return useContext(ActiveSubjectContext);
}

/**
 * Объявляет предмет текущей страницы.
 *
 * При уходе со страницы сбрасывает его в `null`, а не оставляет как есть:
 * иначе панель на дневнике продолжала бы утверждать, что открыта физика.
 */
export function usePageSubject(goalId: string | null | undefined) {
  const { setPageSubject } = useActiveSubject();

  useEffect(() => {
    setPageSubject(goalId ?? null);
    return () => setPageSubject(null);
  }, [goalId, setPageSubject]);
}
