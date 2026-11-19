import { LocaleProvider } from "@/lib/i18n/react";
import { serverLocale } from "@/lib/i18n/server";

// Страницы входа рисует сервер: язык берётся из куки, чтобы сервер и браузер показали одно и то же.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale={await serverLocale()}>{children}</LocaleProvider>;
}
