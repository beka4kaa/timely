"use client";

import { Check, ChevronDown, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type ImageModelInfo,
  type ImageQuality,
  QUALITY_OPTIONS,
  findImageModel,
  imageModelLabel,
  supportsQuality,
} from "@/lib/image-model-selection";

/**
 * Селекторы модели генерации и её качества.
 *
 * Стоят рядом со стилем и палитрой и намеренно повторяют их манеру (та же
 * пилюля, тот же дропдаун, тот же aria-label): это одна панель настроек
 * генерации, а не отдельный экран. Технические model ID в интерфейс не
 * выводятся — только человеческие названия.
 *
 * Keyboard navigation и роли достаются от Radix DropdownMenu — тем же
 * механизмом, что уже работает у StyleSelectorDropdown.
 */

interface ImageModelSelectorDropdownProps {
  value: string;
  models: ImageModelInfo[];
  onChange: (value: string) => void;
}

export function ImageModelSelectorDropdown({
  value,
  models,
  onChange,
}: ImageModelSelectorDropdownProps) {
  if (models.length === 0) return null;
  const activeLabel = imageModelLabel(value, models);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Модель изображения: ${activeLabel}`}
        className="flex h-8 max-w-[160px] items-center gap-1.5 rounded-full border border-[#ded9d1] bg-white/55 px-2.5 text-[#706960] outline-none transition-colors hover:border-[#c7a06c] hover:bg-[#fffaf1] hover:text-[#4a433b] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate text-[10px] font-medium">{activeLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-[#a39c93]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-72 border-[#dcd7cf] bg-[#fbfaf7] text-[#49423a] shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
      >
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
          Модель изображения
        </div>
        {models.map((model) => {
          const isActive = value === model.id;
          return (
            <DropdownMenuItem
              key={model.id}
              onClick={() => onChange(model.id)}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 focus:bg-[#f1eee8] focus:text-[#302d2a]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">{model.label}</span>
                  {/* Бейдж «Текущая» ведём от РЕАЛЬНОГО дефолта инсталляции,
                      который приходит с backend, а не от статического флага. */}
                  {model.default && (
                    <span className="shrink-0 rounded-full bg-[#f0e7d7] px-1.5 py-0.5 text-[9px] font-medium text-[#8a6a33]">
                      Текущая
                    </span>
                  )}
                  {model.supports_quality && !model.default && (
                    <span className="shrink-0 rounded-full bg-[#e9e5f2] px-1.5 py-0.5 text-[9px] font-medium text-[#6a5b8a]">
                      Точнее · дороже
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-[#8f887f]">
                  {model.description}
                </div>
              </div>
              {isActive && <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#b7792d]" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface QualitySelectorDropdownProps {
  value: ImageQuality;
  modelId: string;
  models: ImageModelInfo[];
  onChange: (value: ImageQuality) => void;
}

export function QualitySelectorDropdown({
  value,
  modelId,
  models,
  onChange,
}: QualitySelectorDropdownProps) {
  // У модели без поддержки качества селектора нет вовсе: disabled-контрол,
  // который ни на что не влияет, только засоряет и без того плотную панель.
  if (!supportsQuality(modelId, models)) return null;
  const active = QUALITY_OPTIONS.find((option) => option.id === value) ?? QUALITY_OPTIONS[1];
  const modelLabel = findImageModel(modelId, models)?.label ?? modelId;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Качество изображения (${modelLabel}): ${active.label}`}
        className="flex h-8 items-center gap-1.5 rounded-full border border-[#ded9d1] bg-white/55 px-2.5 text-[#706960] outline-none transition-colors hover:border-[#c7a06c] hover:bg-[#fffaf1] hover:text-[#4a433b] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
      >
        <span className="text-[10px] font-medium">{active.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-[#a39c93]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56 border-[#dcd7cf] bg-[#fbfaf7] text-[#49423a] shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
      >
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
          Качество
        </div>
        {QUALITY_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => onChange(option.id)}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 focus:bg-[#f1eee8] focus:text-[#302d2a]"
          >
            <span className="flex-1 text-[12px]">
              {option.label}
              <span className="text-[#8f887f]"> — {option.description}</span>
            </span>
            {value === option.id && <Check className="h-4 w-4 shrink-0 text-[#b7792d]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
