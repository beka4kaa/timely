import { Eye } from "lucide-react";
import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";
import { PeerReviewRoom } from "@/components/arena/PeerReviewRoom";

export default function PeerReviewPage() {
  return (
    <CoffeePageShell
      eyebrow="Взаимная проверка"
      title="Arena Review"
      description="Сравните решение ученика с эталоном и вынесите спокойное, аргументированное решение."
      icon={<Eye className="h-5 w-5" />}
    >
      <PeerReviewRoom />
    </CoffeePageShell>
  );
}
