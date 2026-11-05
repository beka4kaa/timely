// Загрузка учебника.
//
// Полоса прогресса здесь определённая, а не крутящийся спиннер: файл может весить десятки
// мегабайт, и «сколько улетело» единственное, что отличает работающую загрузку от зависшей.
// Ради этого в `curriculum-api` используется XHR, а не fetch, у которого нет события
// прогресса отправки.

"use client";

import { useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import {
  ACCEPTED_EXTENSIONS,
  checkFileBeforeUpload,
  formatBytes,
} from "@/lib/curriculum-progress";
import { useCurriculumStore } from "@/stores/curriculum-store";

import { WizardHead } from "./wizard-head";

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
      setLocalError(check.error ?? "Этот файл не подходит.");
      setFile(null);
      return;
    }
    setLocalError(null);
    setFile(candidate);
  };

  const percent = Math.round(progress * 100);

  return (
    <>
      <WizardHead title="Загрузи учебник">
        PDF или EPUB до 60 МБ. В программе будут ссылки на его страницы и разделы.
      </WizardHead>

      <section className="card wz-sheet">
        <button
          type="button"
          className={`wz-drop${dragging ? " is-over" : ""}`}
          disabled={busy}
          aria-describedby={localError ? "curriculum-upload-error" : undefined}
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
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="book" />
          {file ? (
            <>
              <b>{file.name}</b>
              <span>{formatBytes(file.size)}</span>
            </>
          ) : (
            <>
              <b>Перетащи файл сюда</b>
              <span>или нажми, чтобы выбрать</span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-label="Файл учебника"
          onChange={(event) => pick(event.target.files?.[0])}
        />

        {localError ? (
          <p id="curriculum-upload-error" className="cur-err" role="alert">
            {localError}
          </p>
        ) : null}

        {busy ? (
          <div className="wz-upload" role="status">
            <span className="tube">
              {percent > 0 ? <i style={{ width: `${percent}%` }} /> : null}
            </span>
            <span className="muted">
              {progress >= 1 ? "Файл загружен, начинаю читать…" : `Загружено ${percent}%`}
            </span>
          </div>
        ) : null}

        <div className="cur-acts">
          <button
            type="button"
            className="btn btn-main"
            onClick={() => file && void upload(file, file.name.replace(/\.(?:pdf|epub)$/i, ""))}
            disabled={!file || busy}
          >
            {busy ? "Загружаю…" : "Загрузить и прочитать"}
          </button>
        </div>
      </section>
    </>
  );
}
