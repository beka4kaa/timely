"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Whiteboard from "@/components/whiteboard/Whiteboard";
import { AIChat } from "@/components/board/ai-chat";

const MOBILE_BREAKPOINT = 768;

export default function WhiteboardPage() {
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

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

  const handleCrop = (result: any) => {
    console.log("📦 Crop callback received:", result.boundingBox);
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-50 dark:bg-[#0A0A0A] transition-colors">
      {/* ── Whiteboard area ── */}
      <div
        className="absolute inset-0 transition-[right] duration-300 ease-in-out"
        style={{ right: isChatOpen && !isMobile ? "25%" : 0 }}
      >
        <Whiteboard onCrop={handleCrop} />
      </div>

      {/* ── Toggle button ── */}
      <div
        className="absolute top-3 z-[60]"
        style={{
          right: isChatOpen && !isMobile ? "calc(25% + 12px)" : "12px",
          transition: "right 0.3s ease-in-out",
        }}
      >
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleChat}
                className="h-10 w-10 rounded-xl bg-white/70 dark:bg-black/70 backdrop-blur-md border border-black/10 dark:border-white/20 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white shadow-xl transition-all"
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

      {/* ── Chat sidebar (floating card) ── */}
      <div
        className={`
          absolute z-[55]
          inset-y-0 right-0 w-full
          md:inset-y-3 md:right-3 md:w-[calc(25%-12px)] md:min-w-[300px]
          transition-transform duration-300 ease-in-out
          ${isChatOpen ? "translate-x-0" : "translate-x-[110%]"}
          overflow-hidden md:rounded-2xl md:shadow-2xl md:border border-black/10 dark:border-white/10
        `}
      >
        {isMobile && isChatOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleChat}
            className="absolute top-3 right-3 z-30 h-8 w-8 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
        <AIChat />
      </div>

      {/* ── Mobile overlay ── */}
      {isMobile && isChatOpen && (
        <div
          className="absolute inset-0 z-10 bg-black/60 transition-opacity duration-300"
          onClick={toggleChat}
        />
      )}
    </div>
  );
}
