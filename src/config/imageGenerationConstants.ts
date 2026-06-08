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
  {
    id: "flat",
    label: "Flat",
    icon: Layers,
    prompt_suffix: "clean flat vector illustration, simple geometry, solid background, 2D"
  },
  {
    id: "2_5d",
    label: "2.5D",
    icon: Box,
    prompt_suffix: "isometric 2.5D render, smooth plastic texture, soft lighting, educational diagram"
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
