"use client";

import React, { useState, useEffect, useCallback } from "react";
import { MessageSquare, X, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AIChat } from "./ai-chat";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BoardLayoutProps {
  /** Custom canvas content — falls back to a grid placeholder */
  children?: React.ReactNode;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MOBILE_BREAKPOINT = 768; // px

// ─── Component ───────────────────────────────────────────────────────────────

export function BoardLayout({ children }: BoardLayoutProps) {
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (mobile) setIsChatOpen(false);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const toggleChat = useCallback(() => setIsChatOpen((prev) => !prev), []);

  return (
    <div className="relative w-full h-full overflow-hidden bg-zinc-950">
      {/* ── Canvas area ─────────────────────────────────────────────────── */}
      <div
        className="absolute inset-0 transition-[right] duration-300 ease-in-out"
        style={{ right: isChatOpen && !isMobile ? "25%" : 0 }}
      >
        {children ?? <CanvasPlaceholder />}
      </div>

      {/* ── Toggle button (floating) ────────────────────────────────────── */}
      <div className="absolute top-3 right-4 z-[60]">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleChat}
                className="h-10 w-10 rounded-xl bg-zinc-900/80 backdrop-blur-md border border-white/[0.08] text-zinc-400 hover:text-white hover:bg-zinc-800/90 hover:border-white/[0.12] shadow-xl transition-all"
              >
                {isChatOpen ? (
                  <PanelRightClose className="w-[18px] h-[18px]" />
                ) : (
                  <PanelRightOpen className="w-[18px] h-[18px]" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
              {isChatOpen ? "Скрыть чат" : "Показать чат"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* ── Chat sidebar ────────────────────────────────────────────────── */}
      <div
        className={`
          absolute top-0 bottom-0 right-0 z-[55]
          w-full md:w-[25%] min-w-[280px]
          transition-transform duration-300 ease-in-out
          ${isChatOpen ? "translate-x-0" : "translate-x-full"}
          border-l border-white/[0.06]
        `}
      >
        {/* Mobile close button */}
        {isMobile && isChatOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleChat}
            className="absolute top-3 right-3 z-30 h-8 w-8 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
        <AIChat />
      </div>

      {/* ── Mobile overlay ──────────────────────────────────────────────── */}
      {isMobile && isChatOpen && (
        <div
          className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
          onClick={toggleChat}
        />
      )}
    </div>
  );
}

// ─── Canvas placeholder ──────────────────────────────────────────────────────

function CanvasPlaceholder() {
  return (
    <div
      className="w-full h-full relative"
      style={{
        backgroundColor: "#09090b",
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }}
    >
      {/* Center label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex flex-col items-center gap-3 text-zinc-700 select-none">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
            <MessageSquare className="w-7 h-7 text-zinc-600" />
          </div>
          <p className="text-sm font-medium text-zinc-600">Canvas Area</p>
          <p className="text-xs text-zinc-700">Здесь будет доска для рисования</p>
        </div>
      </div>
    </div>
  );
}
