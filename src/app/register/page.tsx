import { redirect } from 'next/navigation'

// Старый адрес регистрации. Форма одна — на /auth/register; здесь осталась
// копия в прежнем оформлении, которую уже никто не обновлял.
export default function LegacyRegisterPage() {
  redirect('/auth/register')
}
