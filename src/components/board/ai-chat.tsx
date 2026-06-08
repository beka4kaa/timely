"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";
import { SendHorizonal, Bot, User, Plus, History, MoreHorizontal, Loader2, Paperclip, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LessonFlow, type BoardData } from "./AITutorBoard";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StyleSelectorDropdown, PaletteSelectorDropdown } from "./style-controls/StyleSelectors";
import { useWhiteboardStore } from "@/stores/whiteboard";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * Optional structured "lesson board" data returned by the AI for this
   * message (tables, formulas, charts, diagrams) — rendered inline via
   * <AITutorBoard/> using pixel-perfect macro widgets instead of the model
   * trying (and failing) to hand-draw grids out of primitive lines.
   */
  board?: BoardData | null;
}

export interface AIChatProps {
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AIChat({ className }: AIChatProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Привет! Я — твой AI-тьютор. Напиши задачу или нарисуй её на доске, а я помогу с решением 🎯",
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [generationStyle, setGenerationStyle] = useState("flat");
  const [generationPalette, setGenerationPalette] = useState("he_inspired");

  const executeActions = useWhiteboardStore((s) => s.executeActions);
  const camera = useWhiteboardStore((s) => s.camera);

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const sendMessage = async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsLoading(true);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      // Build history for context (exclude welcome message)
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/ai/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: text, 
          history,
          style: generationStyle,
          palette: generationPalette
        }),
      });

      // The body may be non-JSON (e.g. a proxy 500 / "Internal Server Error"
      // when the model is slow), so parse defensively.
      const rawBody = await res.text();
      let data: any = {};
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        data = {};
      }

      if (!res.ok) {
        throw new Error(
          data.error ||
            (res.status === 504
              ? "Модель долго отвечает. Попробуйте упростить запрос или повторить."
              : `Сервер вернул ${res.status}. Возможно, модель перегружена — попробуйте ещё раз.`)
        );
      }

      // The AI may return structured "lesson board" data (board_steps with
      // table/formula/barchart/text/line commands) — rendered inline as a
      // pixel-perfect AITutorBoard widget instead of drawn by the model.
      let board: BoardData | null =
        data.board && Array.isArray(data.board.board_steps) && data.board.board_steps.length > 0
          ? (data.board as BoardData)
          : null;

      // Extract visual commands and place them directly on the whiteboard
      if (board) {
        const state = useWhiteboardStore.getState();
        const baseX = state.camera.x + 200; // Place near current view
        const baseY = state.camera.y + 100;
        const actionsToExecute: any[] = [];

        board.board_steps.forEach((step, stepIndex) => {
          step.commands.forEach((cmd: any, cmdIndex) => {
            const idBase = `ai-${Date.now()}-${stepIndex}-${cmdIndex}`;
            const cx = baseX + (parseFloat(cmd.x) || 0);
            const cy = baseY + (parseFloat(cmd.y) || 0);

            if (cmd.type === "image_with_labels") {
              if (cmd.image_url) {
                actionsToExecute.push({
                  type: "CREATE_IMAGE",
                  payload: {
                    id: idBase,
                    position: { x: cx, y: cy },
                    src: cmd.image_url,
                    width: 400,
                    height: 400,
                    rotation: 0
                  }
                });
                
                // Add labels if any
                if (cmd.labels && Array.isArray(cmd.labels)) {
                  cmd.labels.forEach((label: any, idx: number) => {
                    actionsToExecute.push({
                      type: "CREATE_TEXT",
                      payload: {
                        id: `${idBase}-lbl-${idx}`,
                        position: { x: cx + (label.x_percent || 50) * 4, y: cy + (label.y_percent || 50) * 4 },
                        content: label.text || label.content || ""
                      }
                    });
                  });
                }
              } else if (cmd.image_error) {
                // If there's an error, convert it to a text command so it shows in the chat
                cmd.type = "text";
                cmd.content = `❌ **Ошибка генерации изображения:** ${
                  typeof cmd.image_error === "object" ? cmd.image_error.message : cmd.image_error
                }\n\n*Убедитесь, что OPENROUTER_API_KEY задан в .env файле.*`;
                // We leave this as "text" so it WILL BE moved to the whiteboard below!
              }
            }

            // Map geometric and text commands to native Whiteboard actions
            if (cmd.type === "circle") {
              const r = parseFloat(cmd.r) || 50;
              actionsToExecute.push({
                type: "DRAW_SHAPE",
                payload: {
                  id: idBase,
                  shape: "ellipse",
                  position: { x: cx - r, y: cy - r },
                  width: r * 2,
                  height: r * 2,
                  color: cmd.color || "#ffffff"
                }
              });
            } else if (cmd.type === "rect") {
              actionsToExecute.push({
                type: "DRAW_SHAPE",
                payload: {
                  id: idBase,
                  shape: "rect",
                  position: { x: cx, y: cy },
                  width: parseFloat(cmd.w) || 100,
                  height: parseFloat(cmd.h) || 100,
                  color: cmd.color || "#ffffff"
                }
              });
            } else if (cmd.type === "line") {
              const x1 = parseFloat(cmd.x1) || 0;
              const y1 = parseFloat(cmd.y1) || 0;
              const x2 = parseFloat(cmd.x2) || 0;
              const y2 = parseFloat(cmd.y2) || 0;
              const minX = Math.min(x1, x2);
              const maxX = Math.max(x1, x2);
              const minY = Math.min(y1, y2);
              const maxY = Math.max(y1, y2);
              const flip = (x1 < x2 && y1 > y2) || (x1 > x2 && y1 < y2);
              
              actionsToExecute.push({
                type: "DRAW_SHAPE",
                payload: {
                  id: idBase,
                  shape: "line",
                  position: { x: baseX + minX, y: baseY + minY },
                  width: Math.max(1, maxX - minX),
                  height: Math.max(1, maxY - minY),
                  flip,
                  color: cmd.color || "#ffffff"
                }
              });
            } else if (cmd.type === "text" || cmd.type === "formula") {
              actionsToExecute.push({
                type: "CREATE_TEXT",
                payload: {
                  id: idBase,
                  position: { x: cx, y: cy },
                  content: cmd.type === "formula" ? `$${cmd.content}$` : (cmd.content || "")
                }
              });
            }
          });
        });

        if (actionsToExecute.length > 0) {
          state.executeActions(actionsToExecute);
        }

        // Filter out ALL visual commands from board_steps so they don't show in the chat at all!
        // We only leave semantic data like tables or barcharts (if any).
        const typesToMove = ["image_with_labels", "circle", "rect", "line", "text", "formula"];
        board.board_steps = board.board_steps.map((step) => ({
          ...step,
          commands: step.commands.filter((cmd: any) => !typesToMove.includes(cmd.type))
        })).filter((step) => step.commands.length > 0);
        
        // If board_steps is empty after filtering, set board to null
        if (board.board_steps.length === 0) {
          board = null;
        }
      }

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.reply || (board ? "Вот разбор:" : "Готово."),
        board,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: any) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `⚠️ ${e.message || "Произошла ошибка. Попробуйте ещё раз."}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content:
          "Привет! Я — твой AI-тьютор. Напиши задачу или нарисуй её на доске, а я помогу с решением 🎯",
      },
    ]);
  };

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-[#0a0a0a] ${className ?? ""}`}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-800/50 shrink-0">
        <h2 className="text-[13px] font-medium text-zinc-200">
          AI Tutor
        </h2>
        <div className="flex items-center gap-3 text-zinc-500">
          <button
            onClick={clearChat}
            className="hover:text-zinc-300 transition-colors"
            title="Новый чат"
          >
            <Plus className="w-[15px] h-[15px]" />
          </button>
          <button className="hover:text-zinc-300 transition-colors">
            <History className="w-[15px] h-[15px]" />
          </button>
          <button className="hover:text-zinc-300 transition-colors">
            <MoreHorizontal className="w-[15px] h-[15px]" />
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-5">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
          >
            {/* Avatar */}
            <div
              className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs bg-zinc-800 text-zinc-400 border border-zinc-700/50 mt-0.5`}
            >
              {msg.role === "assistant" ? (
                <Bot className="w-3.5 h-3.5" />
              ) : (
                <User className="w-3.5 h-3.5" />
              )}
            </div>

            {/* Bubble */}
            <div
              className={`flex flex-col gap-3 max-w-[92%] px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap ${
                msg.role === "assistant"
                  ? "bg-zinc-900/80 text-zinc-200 rounded-2xl rounded-tl-sm border border-zinc-800/50"
                  : "bg-white text-black rounded-2xl rounded-tr-sm"
              }`}
            >
              {msg.content}

              {/* Inline "lesson board": tables/formulas/charts/diagrams
                  rendered as pixel-perfect macro widgets (not hand-drawn).
                  Uses LessonFlow (natural document flow) rather than the
                  square scaled AITutorBoard canvas — in a narrow chat
                  bubble the canvas's scale factor (~0.25) would shrink
                  text/tables/charts to near-illegible sizes. */}
              {msg.board && (
                <LessonFlow
                  data={msg.board}
                  showHeader={!!(msg.board.subject || msg.board.topic)}
                />
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs bg-zinc-800 text-zinc-400 border border-zinc-700/50 mt-0.5">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="max-w-[85%] px-4 py-3 text-[13px] leading-relaxed bg-zinc-900/80 text-zinc-400 rounded-2xl rounded-tl-sm border border-zinc-800/50 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Думаю...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ── */}
      <div className="px-3 pb-3 pt-2 shrink-0">
        <div className="flex flex-col rounded-3xl border border-zinc-800 bg-[#121212] px-3 pt-3 pb-2 transition-colors focus-within:border-zinc-700">
          <textarea
            ref={textareaRef}
            placeholder="Describe the scientific figure you want to create..."
            rows={1}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            className="w-full resize-none bg-transparent px-2 text-[14px] text-zinc-200 placeholder:text-zinc-500 outline-none min-h-[30px] max-h-[160px] leading-relaxed mb-2"
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg">
                <Paperclip className="w-[18px] h-[18px]" />
              </Button>
              <PaletteSelectorDropdown value={generationPalette} onChange={setGenerationPalette} />
            </div>

            <div className="flex items-center gap-1">
              <StyleSelectorDropdown value={generationStyle} onChange={setGenerationStyle} />
              
              <span className="px-3 text-[13px] font-medium text-zinc-200">Auto</span>
              
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={sendMessage}
                      disabled={isLoading || !inputValue.trim()}
                      className="h-8 w-8 ml-1 rounded-full bg-white text-black hover:bg-zinc-200 transition-colors disabled:opacity-30 disabled:bg-zinc-700 disabled:text-zinc-500"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ArrowUp className="w-4 h-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Отправить (Enter)
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
