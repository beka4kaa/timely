import Link from "next/link";

import { serverT } from "@/lib/i18n/server";

import { PeerReviewRoom } from "@/components/arena/PeerReviewRoom";

export default async function PeerReviewPage() {
  const { t } = await serverT();
  return (
    <div className="content view">
      <Link className="back" href="/dashboard/arena/solve">
        {t("Контесты")}
      </Link>
      <header className="head">
        <h1 className="title">{t("Арена")}</h1>
      </header>
      <PeerReviewRoom />
    </div>
  );
}
