// Страницы, на которых панели вопросов быть не должно.
//
// Пока такая одна — «Тьютор»: чат внутри чата бессмыслен. Список нужен не
// только самой панели: `AskRailProvider` держит ширину, на которую сдвинута
// страница, и без него контент уехал бы вправо под панель, которой нет.

const RAIL_FREE_ROUTES = ["/dashboard/chat"];

export function isRailFreeRoute(pathname: string): boolean {
  return RAIL_FREE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}
