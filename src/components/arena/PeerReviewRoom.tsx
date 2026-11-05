// Взаимная проверка решений. Голоса пока некуда сохранять: `ReviewVote` есть в модели,
// но очереди и записи голоса в API нет. Поэтому честно пусто, а не пример с выдуманным решением.

import Link from "next/link";

export function PeerReviewRoom() {
  return (
    <section className="ct-note card">
      <h2>Решений на проверку пока нет</h2>
      <p>Здесь можно будет проверять чужие решения. Сейчас взаимная проверка ещё не работает.</p>
      <Link className="btn btn-line" href="/dashboard/arena/solve">
        Контесты
      </Link>
    </section>
  );
}
