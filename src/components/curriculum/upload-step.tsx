// Загрузка учебника.
//
// Полоса прогресса здесь определённая, а не крутящийся спиннер: файл может
// весить десятки мегабайт, и «сколько улетело» — единственное, что отличает
// работающую загрузку от зависшей. Ради этого в `curriculum-api` используется
// XHR, а не fetch, у которого нет события прогресса отправки.

"use client";

import { FileText, Loader2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ACCEPTED_EXTENSIONS,
  checkFileBeforeUpload,
  formatBytes,
} from "@/lib/curriculum-progress";
import { useCurriculumStore } from "@/stores/curriculum-store";
import { cn } from "@/lib/utils";

export function UploadStep() {
  const upload = useCurriculumStore((s) => s.upload);
  const busy = useCurriculumStore((s) => s.busy);
  const progress = useCurriculumStore((s) => s.uploadProgress);

  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (candidate: File | null | undefined) => {
    if (!candidate) return;
    const check = checkFileBeforeUpload(candidate);
    if (!check.ok) {
      setLocalError(check.error ?? "Файл не подходит.");
      setFile(null);
      return;
    }
    setLocalError(null);
    setFile(candidate);
  };

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Загрузите учебник</h2>
        <p className="text-sm text-muted-foreground">
          PDF или EPUB до 60 МБ. В программе будут ссылки на страницы или разделы.
        </p>
      </header>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          pick(event.dataTransfer.files?.[0]);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition",
          dragging ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {file ? (
          <>
            <FileText className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
          </>
        ) : (
          <>
            <UploadCloud className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Перетащите файл сюда</p>
              <p className="text-xs text-muted-foreground">или нажмите, чтобы выбрать</p>
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(event) => pick(event.target.files?.[0])}
        />
      </div>

      {localError && <p className="text-sm text-red-500">{localError}</p>}

      {busy && (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {progress >= 1
              ? "Файл загружен, начинаем обработку…"
              : `Загружено ${Math.round(progress * 100)}%`}
          </p>
        </div>
      )}

      <Button
        onClick={() =>
          file && void upload(file, file.name.replace(/\.(?:pdf|epub)$/i, ""))
        }
        disabled={!file || busy}
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Загрузить и обработать
      </Button>
    </section>
  );
}
