"use client";

// Голосовой ввод: слушает одну фразу и отдаёт текст по мере распознавания.
// Где браузер не умеет распознавать речь, `supported` ложно и кнопки микрофона нет.

import { useCallback, useEffect, useRef, useState } from "react";

import { heardFrom, recognitionCtor, type RecognitionLike } from "@/lib/dictation";

export function useDictation(onText: (text: string, final: boolean) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<RecognitionLike | null>(null);
  const handler = useRef(onText);
  handler.current = onText;

  useEffect(() => setSupported(Boolean(recognitionCtor())), []);
  useEffect(() => () => recognition.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      const heard = heardFrom(event.results);
      handler.current(heard.text, heard.final);
    };
    const done = () => {
      recognition.current = null;
      setListening(false);
    };
    rec.onend = done;
    rec.onerror = done;
    recognition.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      // Микрофон занят или запрещён: просто не слушаем.
      done();
    }
  }, []);

  const stop = useCallback(() => recognition.current?.stop(), []);

  return { supported, listening, start, stop };
}
