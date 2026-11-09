import { redirect } from "next/navigation";

// Дневник стал частью «Недели»: уроки, задания и оценки теперь там вместе с планом.
// Тем, кому план закрыт, «Неделя» сама показывает прежний дневник.
export default function DiaryRedirect() {
  redirect("/dashboard/plan");
}
