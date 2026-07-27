"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
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
  const activePreset = STYLE_PRESETS.find((preset) => preset.id === value) || STYLE_PRESETS[0];
  const ActiveIcon = activePreset.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Стиль иллюстрации: ${activePreset.label}`}
        className="flex h-8 items-center gap-1.5 rounded-full border border-[#ded9d1] bg-white/55 px-2.5 text-[#706960] outline-none transition-colors hover:border-[#c7a06c] hover:bg-[#fffaf1] hover:text-[#4a433b] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
      >
        <ActiveIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[10px] font-medium">{activePreset.label}</span>
        <ChevronDown className="h-3 w-3 text-[#a39c93]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56 border-[#dcd7cf] bg-[#fbfaf7] text-[#49423a] shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
      >
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
          Стиль иллюстрации
        </div>
        {STYLE_PRESETS.map((preset) => {
          const PresetIcon = preset.icon;
          const isActive = value === preset.id;
          return (
            <DropdownMenuItem
              key={preset.id}
              onClick={() => onChange(preset.id)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 focus:bg-[#f1eee8] focus:text-[#302d2a]"
            >
              <PresetIcon className="h-4 w-4 text-[#938c82]" />
              <span className="flex-1">{preset.label}</span>
              {isActive && <Check className="h-4 w-4 text-[#b7792d]" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="my-1 bg-[#e4e0d9]" />
        <DropdownMenuItem className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-[#8f887f] focus:bg-[#f1eee8] focus:text-[#4a433b]">
          <Plus className="w-4 h-4" />
          <span>Добавить стиль</span>
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
      <PopoverTrigger
        aria-label={`Цветовая палитра: ${activePalette.label}`}
        className="flex h-8 max-w-[150px] items-center gap-1.5 rounded-full border border-[#ded9d1] bg-white/55 px-2.5 text-[#706960] outline-none transition-colors hover:border-[#c7a06c] hover:bg-[#fffaf1] hover:text-[#4a433b] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
      >
        <span className="flex shrink-0 -space-x-0.5">
          {activePalette.colors.slice(0, 3).map((color) => (
            <span
              key={color}
              className="h-2.5 w-2.5 rounded-full border border-white/80"
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
        <span className="min-w-0 truncate text-[10px] font-medium">
          {activePalette.label}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-[#a39c93]" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-64 border-[#dcd7cf] bg-[#fbfaf7] p-3 shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
      >
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
          Цветовая палитра
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
                    ? "border-[#c8944d] bg-[#fff7e9]"
                    : "border-[#dfdad2] hover:border-[#c5a474] hover:bg-[#f4f0e9]"
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
                <div className="truncate text-xs font-medium text-[#5f574e]">
                  {palette.label}
                </div>
              </div>
            );
          })}

          <div className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[#d3cdc4] p-2 transition-colors hover:border-[#b99667] hover:bg-[#f4f0e9]">
            <Plus className="mb-1 h-4 w-4 text-[#9b958c]" />
            <div className="text-center text-xs font-medium text-[#827b72]">
              Своя палитра
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
