import { FullAccessGate } from "@/components/full-access-gate";
import { WeakPage } from "@/components/mind/weak-page";

export const metadata = {
  title: "Слабые темы",
};

export default function Page() {
  return (
    <FullAccessGate>
      <WeakPage />
    </FullAccessGate>
  );
}
