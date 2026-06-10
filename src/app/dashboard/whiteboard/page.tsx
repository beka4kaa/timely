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
    <div className="relative w-full h-full overflow-hidden bg-zinc-950">
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
                className="h-10 w-10 rounded-xl bg-zinc-900/90 backdrop-blur-md border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 hover:border-zinc-600 shadow-xl transition-all"
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

      {/* ── Chat sidebar ── */}
      <div
        className={`
          absolute top-0 bottom-0 right-0 z-[55]
          w-full md:w-[25%] min-w-[280px]
          transition-transform duration-300 ease-in-out
          ${isChatOpen ? "translate-x-0" : "translate-x-full"}
          border-l border-zinc-800
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
