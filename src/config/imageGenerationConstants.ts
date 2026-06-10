import { Layers, Box, Hexagon, PenTool, type LucideIcon } from "lucide-react";

export interface StylePreset {
  id: string;
  label: string;
  icon: LucideIcon;
  prompt_suffix: string;
}

export interface ColorPalette {
  id: string;
  label: string;
  colors: string[];
  prompt_suffix: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  // NB: prompt_suffix здесь — display-only (на бэкенд уходит только id; реальный
  // positive/negative берётся из backend STYLE_PRESETS в image_enrichment.py).
  // Держим текст в синхроне с бэкендом, чтобы он не вводил в заблуждение.
  {
    id: "flat",
    label: "Flat",
    icon: Layers,
    prompt_suffix: "Strictly 2D flat vector graphic, SVG style, pure solid colors ONLY, black outlines, coloring book style, absolute minimalism."
  },
  {
    id: "2_5d",
    label: "2.5D",
    icon: Box,
    prompt_suffix: "Isometric 2.5D diagram, orthographic projection, soft minimal shading, clean plastic vector style, pure white background."
  },
  {
    id: "3d",
    label: "3D",
    icon: Hexagon,
    prompt_suffix: "3D scientific render, octane render, high detail, volumetric lighting"
  },
  {
    id: "sketch",
    label: "Sketch",
    icon: PenTool,
    prompt_suffix: "rough pencil sketch, hand-drawn technical blueprint, white paper background"
  }
];

export const COLOR_PALETTES: ColorPalette[] = [
  // ── Natural / geographic palettes ──────────────────────────────────────────
  // Default-first: медицинские/биотех-палитры (ниже) уводили географические
  // схемы в красно-«мясные» тона. `natural-earth` — палитра по умолчанию
  // (дефолт задаётся в ai-chat.tsx; первой в массиве — чтобы COLOR_PALETTES[0]
  // тоже указывал на неё как на надёжный фолбэк).
  {
    id: "natural-earth",
    label: "Natural Earth",
    colors: ["#3498DB", "#2ECC71", "#F1C40F", "#95A5A6"],
    prompt_suffix: "strictly using natural realistic colors: clear water blue, nature green, earth brown, white clouds, realistic geographical tones"
  },
  {
    id: "oceanic-clean",
    label: "Oceanic Clean",
    colors: ["#1B4F72", "#2874A6", "#85C1E9", "#D6EAF8"],
    prompt_suffix: "strictly using color palette: deep ocean blue, sky blue, pure white, cool grey"
  },
  {
    id: "monochrome-ink",
    label: "Monochrome Ink",
    colors: ["#17202A", "#5D6D7E", "#AEB6BF", "#F8F9F9"],
    prompt_suffix: "strictly using color palette: pure black, dark slate, light grey, pure white, no bright colors"
  },
  // ── Medical / biotech palettes (legacy) ─────────────────────────────────────
  {
    id: "he_inspired",
    label: "H&E Inspired",
    colors: ["#A4243B", "#D8C3A5", "#8E8D8A", "#E98074"],
    prompt_suffix: "strictly using color palette: deep reds, warm beige, gray, soft pink"
  },
  {
    id: "warm_biotech",
    label: "Warm Biotech",
    colors: ["#2E9CCA", "#29648A", "#AAABB8", "#464866"],
    prompt_suffix: "strictly using color palette: cyan, deep blue, light gray, dark slate"
  },
  {
    id: "in_vitro_violet",
    label: "In Vitro Violet",
    colors: ["#5E3C58", "#BFB5AF", "#E2D8DE", "#2E3B32"],
    prompt_suffix: "strictly using color palette: deep violet, muted beige, light mauve, dark green"
  }
];
