// Разговор по публичной ссылке живёт вне кабинета, но выглядит как чат: те же стили.
import "@/styles/timely/index.css";

import { LocaleProvider } from "@/lib/i18n/react";
import { serverLocale } from "@/lib/i18n/server";

// Страницу рисует сервер: язык из куки, чтобы сервер и браузер показали одно и то же.
export default async function ShareLayout({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale={await serverLocale()}>{children}</LocaleProvider>;
}
