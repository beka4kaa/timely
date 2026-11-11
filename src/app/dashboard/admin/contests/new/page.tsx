"use client";

// Новый контест: черновик с завтрашней датой, бронзой и кольцами.

import Link from "next/link";

import { ContestEditor } from "@/components/arena/contest-editor";
import { useMe } from "@/lib/contest-api";
import { useNow } from "@/lib/use-now";

export default function NewContestPage() {
  const { me, loading } = useMe();
  const now = useNow(30_000);
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
      ) : (
        <ContestEditor canTopTiers={Boolean(me.is_staff)} now={now} />
      )}
    </div>
  );
}
