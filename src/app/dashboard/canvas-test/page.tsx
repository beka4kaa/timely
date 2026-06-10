"use client";

import React, { useEffect, useRef } from "react";

/**
 * Minimal test page to check if canvas drawing works at all.
 * No hooks, no stores, just raw pointer events → canvas 2D.
 */
export default function CanvasTestPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Fill with dark bg so we can see strokes
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    console.log("[test] Canvas ready:", canvas.width, "x", canvas.height);
  }, []);

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    console.log("[test] pointerDown", e.button, e.clientX, e.clientY);
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    isDrawing.current = true;
    lastPoint.current = { x: e.clientX, y: e.clientY };
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || !lastPoint.current) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const prevX = lastPoint.current.x - rect.left;
    const prevY = lastPoint.current.y - rect.top;

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    ctx.lineTo(x, y);
    ctx.stroke();

    lastPoint.current = { x: e.clientX, y: e.clientY };
  };

  const handleUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    console.log("[test] pointerUp");
    isDrawing.current = false;
    lastPoint.current = null;
  };

  return (
    <div className="absolute inset-0 bg-zinc-950">
      <canvas
        ref={canvasRef}
        className="block touch-none"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
      />
      <div className="absolute top-4 left-4 text-white text-sm bg-zinc-800 px-3 py-1 rounded-lg pointer-events-none">
        Canvas Test — draw with mouse
      </div>
    </div>
  );
}
