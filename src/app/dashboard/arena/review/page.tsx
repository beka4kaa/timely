import Link from "next/link";

import { PeerReviewRoom } from "@/components/arena/PeerReviewRoom";
import "@/styles/timely/page-compete.css";

export default function PeerReviewPage() {
  return (
    <div className="content view">
      <Link className="back" href="/dashboard/arena/solve">
        Контесты
      </Link>
      <header className="head">
        <h1 className="title">Арена</h1>
      </header>
      <PeerReviewRoom />
    </div>
  );
}
