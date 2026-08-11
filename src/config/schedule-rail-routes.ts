// Страницы, где панель справа — помощник по расписанию, а не вопросы по книге.
//
// На «Плане» вопрос ученика почти всегда про календарь: разгрузи среду, я
// пропустил три дня. Держать там чат по учебнику и ОТДЕЛЬНО карточку помощника
// значило бы делить один угол экрана между двумя разговорами — так и было до
// этой правки, и выбирать между ними приходилось глазами.
//
// Список вынесен из компонента, чтобы правило проверялось `node --test` без
// React, — ровно как `rail-free-routes.ts`.

const SCHEDULE_RAIL_ROUTES = ["/dashboard/plan"];

export function isScheduleRailRoute(pathname: string): boolean {
  return SCHEDULE_RAIL_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}
