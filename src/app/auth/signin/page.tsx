import { localeFromParams } from "@/lib/app-locale"
import { LocaleProvider, RememberLocale } from "@/lib/i18n/react"
import { serverLocale } from "@/lib/i18n/server"

import { SignInView } from "./sign-in-view"

// Язык со ссылки английского лендинга (`?lang=en`, в том числе внутри callbackUrl) страница
// берёт сама: NextAuth не пускает на неё middleware, где язык запоминают остальные страницы.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const fromUrl = localeFromParams(await searchParams)
  return (
    <LocaleProvider locale={fromUrl ?? (await serverLocale())}>
      <RememberLocale locale={fromUrl} />
      <SignInView />
    </LocaleProvider>
  )
}
