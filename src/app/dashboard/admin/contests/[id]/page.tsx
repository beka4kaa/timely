"use client";

// Контест в админке: тот же редактор, но с правилами после начала.

import Link from "next/link";
import { useParams } from "next/navigation";

import { ContestEditor } from "@/components/arena/contest-editor";
import { getAdminContest, useMe } from "@/lib/contest-api";
import { useResource } from "@/lib/resource-cache";
import { useNow } from "@/lib/use-now";

export default function EditContestPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const known = Number.isInteger(id) && id > 0;
  const { me, loading } = useMe();
  const now = useNow(30_000);
  const contest = useResource(known && me?.is_admin ? `compete:admin-contest:${id}/` : null, () => getAdminContest(id), {
    ttl: 600_000,
  });

  return (
    <div className="content view">
      <Link className="back" href="/dashboard/admin">
        Админка
      </Link>
      {loading || !now ? (
        <p className="small-note" role="status">
          Загружаю…
        </p>
      ) : !me?.is_admin ? (
        <section className="ct-note card" role="alert">
          <h2>Это только для админов</h2>
        </section>
      ) : !known || (!contest.data && contest.error) ? (
        <section className="ct-note card" role="alert">
          <h2>Контест не открылся</h2>
          <p>Возможно, его удалили. Вернись в админку.</p>
        </section>
      ) : !contest.data ? (
        <p className="small-note" role="status">
          Загружаю контест…
        </p>
      ) : (
        <ContestEditor key={contest.data.id} initial={contest.data} canTopTiers={Boolean(me.is_staff)} now={now} />
      )}
    </div>
  );
}
