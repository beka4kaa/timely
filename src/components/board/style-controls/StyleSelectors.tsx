"use client";

import React from "react";
import { ChevronDown, Check, Plus, Palette, FileText } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { STYLE_PRESETS, COLOR_PALETTES } from "@/config/imageGenerationConstants";

interface StyleSelectorDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

export function StyleSelectorDropdown({ value, onChange }: StyleSelectorDropdownProps) {
  const activePreset = STYLE_PRESETS.find((p) => p.id === value) || STYLE_PRESETS[0];
  const Icon = activePreset?.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <FileText className="w-[18px] h-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 bg-zinc-900 border-zinc-800 text-zinc-200 shadow-xl">
        <div className="px-2 py-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Style Presets
        </div>
        {STYLE_PRESETS.map((preset) => {
          const PresetIcon = preset.icon;
          const isActive = value === preset.id;
          return (
            <DropdownMenuItem
              key={preset.id}
              onClick={() => onChange(preset.id)}
              className="flex items-center gap-2 px-2 py-2 cursor-pointer focus:bg-zinc-800 focus:text-zinc-100 rounded-md"
            >
              <PresetIcon className="w-4 h-4 text-zinc-400" />
              <span className="flex-1">{preset.label}</span>
              {isActive && <Check className="w-4 h-4 text-blue-500" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="bg-zinc-800 my-1" />
        <DropdownMenuItem className="flex items-center gap-2 px-2 py-2 cursor-pointer focus:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-md">
          <Plus className="w-4 h-4" />
          <span>Add Style</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface PaletteSelectorDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

export function PaletteSelectorDropdown({ value, onChange }: PaletteSelectorDropdownProps) {
  const activePalette = COLOR_PALETTES.find((p) => p.id === value) || COLOR_PALETTES[0];

  return (
    <Popover>
      <PopoverTrigger className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <Palette className="w-[18px] h-[18px]" />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-64 p-3 bg-zinc-900 border-zinc-800 shadow-xl">
        <div className="mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Color Palettes
        </div>
        <div className="grid grid-cols-2 gap-2">
          {COLOR_PALETTES.map((palette) => {
            const isActive = value === palette.id;
            return (
              <div
                key={palette.id}
                onClick={() => onChange(palette.id)}
                className={`flex flex-col gap-2 p-2 rounded-md cursor-pointer border transition-colors ${
                  isActive
                    ? "border-blue-500/50 bg-blue-500/10"
                    : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50"
                }`}
              >
                <div className="flex gap-1">
                  {palette.colors.map((color, i) => (
                    <div
                      key={i}
                      className="w-4 h-4 rounded-full shadow-sm"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="text-xs text-zinc-300 font-medium truncate">
                  {palette.label}
                </div>
              </div>
            );
          })}

          <div className="flex flex-col gap-2 p-2 rounded-md cursor-pointer border border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/50 transition-colors justify-center items-center">
            <Plus className="w-4 h-4 text-zinc-500 mb-1" />
            <div className="text-xs text-zinc-400 font-medium text-center">
              Custom Palette
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
