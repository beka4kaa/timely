"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  ScanSearch,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { coffeePanelClass } from "@/components/dashboard/coffee-page-shell";

const authorSteps = [
  "f(x) = x³ − 2x² + 5x − 7",
  "f′(x) = 3x² − 4x + 5",
  "Ответ: 3x² − 4x + 5",
];

const studentSteps = [
  "f(x) = x³ − 2x² + 5x − 7",
  "f′(x) = 3x² − 4x + 5",
  "Ответ ученика: 3x² − 4x + 5",
];

function SolutionSheet({
  type,
  steps,
}: {
  type: "author" | "student";
  steps: string[];
}) {
  const isAuthor = type === "author";

  return (
    <article className={`${coffeePanelClass} flex min-h-[480px] flex-col overflow-hidden`}>
      <header className="flex items-center justify-between border-b border-[#e2dcd3] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span
            className={`grid h-8 w-8 place-items-center rounded-[10px] ${
              isAuthor
                ? "bg-[#e8f0e8] text-[#52705a]"
                : "bg-[#f4eadb] text-[#986334]"
            }`}
          >
            {isAuthor ? (
              <FileCheck2 className="h-4 w-4" />
            ) : (
              <ScanSearch className="h-4 w-4" />
            )}
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#9b9186]">
              {isAuthor ? "Источник" : "На проверке"}
            </p>
            <h2 className="mt-0.5 font-serif text-[17px] font-medium text-[#37312c]">
              {isAuthor ? "Эталонное решение" : "Решение ученика"}
            </h2>
          </div>
        </div>
        <span className="rounded-full border border-[#ded7cd] bg-[#f8f4ed] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8f867d]">
          Лист 1
        </span>
      </header>

      <div className="border-b border-[#e7e1d8] bg-[#f8f4ed] px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a6a35]">
          Условие
        </p>
        <p className="mt-1.5 text-[13px] leading-6 text-[#4d4640]">
          Найдите производную функции{" "}
          <span className="font-serif italic">f(x) = x³ − 2x² + 5x − 7</span>.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center p-5">
        <div className="relative w-full max-w-[430px] rounded-[16px] border border-[#ded8cf] bg-[#fffefa] px-8 py-10 shadow-[0_14px_36px_rgba(70,52,32,0.07)]">
          <span className="absolute right-4 top-3 font-serif text-[10px] italic text-[#b4aca2]">
            Timely worksheet
          </span>
          <div
            className="absolute inset-0 rounded-[16px] opacity-45"
            style={{
              backgroundImage:
                "linear-gradient(rgba(139,111,77,0.08) 1px, transparent 1px)",
              backgroundSize: "100% 30px",
            }}
          />
          <div className="relative space-y-7">
            {steps.map((step, index) => (
              <div key={step} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[#d9c6aa] bg-[#fff9ee] text-[9px] font-semibold text-[#936230]">
                  {index + 1}
                </span>
                <p className="font-serif text-[17px] leading-6 text-[#39332e]">
                  {step}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export function PeerReviewRoom() {
  const [isVoting, setIsVoting] = useState(false);

  const handleVote = async (
    decision: "correct" | "incorrect" | "spam",
  ) => {
    setIsVoting(true);
    await new Promise((resolve) => setTimeout(resolve, 600));

    if (decision === "correct") {
      toast.success("Вы проголосовали: верно");
    } else if (decision === "incorrect") {
      toast.error("Вы проголосовали: неверно");
    } else {
      toast("Жалоба отправлена на дополнительную проверку");
    }

    setIsVoting(false);
  };

  return (
    <div>
      <div className="grid gap-5 lg:grid-cols-2">
        <SolutionSheet type="author" steps={authorSteps} />
        <SolutionSheet type="student" steps={studentSteps} />
      </div>

      <div className="sticky bottom-4 z-20 mx-auto mt-5 flex max-w-[760px] flex-col gap-2 rounded-[20px] border border-[#d8d1c6] bg-[#fbfaf7]/95 p-2.5 shadow-[0_18px_55px_rgba(59,44,28,0.14)] backdrop-blur-xl sm:flex-row">
        <button
          type="button"
          disabled={isVoting}
          onClick={() => handleVote("correct")}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[13px] bg-[#55735d] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[#46624f] disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          Верно
        </button>
        <button
          type="button"
          disabled={isVoting}
          onClick={() => handleVote("incorrect")}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[13px] bg-[#9a4f47] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[#843f38] disabled:opacity-50"
        >
          <XCircle className="h-4 w-4" />
          Неверно
        </button>
        <button
          type="button"
          disabled={isVoting}
          onClick={() => handleVote("spam")}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[13px] border border-[#d7cfc4] bg-[#f1ece4] px-4 text-[12px] font-semibold text-[#6f665d] transition-colors hover:bg-[#e8e1d7] disabled:opacity-50"
        >
          <AlertTriangle className="h-4 w-4" />
          Нарушение
        </button>
      </div>
    </div>
  );
}
