"use client"

import { type FormEvent, useEffect, useState } from 'react'
import { Activity, Dumbbell, Scale, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  type NutritionActivityLevel,
  type NutritionGoal,
  type NutritionProfile,
  type NutritionProfileInput,
  type NutritionSex,
} from './lib'

const DEFAULT_PROFILE: NutritionProfileInput = {
  sex: 'male',
  age: 25,
  heightCm: 175,
  weightKg: 70,
  activityLevel: 'light',
  goal: 'maintain',
}

const GOALS: Array<{ value: NutritionGoal; label: string; hint: string }> = [
  { value: 'lose', label: 'Похудеть', hint: 'мягкий дефицит' },
  { value: 'maintain', label: 'Держать вес', hint: 'без изменения' },
  { value: 'gain', label: 'Набрать', hint: 'мягкий профицит' },
]

const ACTIVITIES: Array<{ value: NutritionActivityLevel; label: string; hint: string }> = [
  { value: 'sedentary', label: 'Сидячий', hint: 'почти без спорта' },
  { value: 'light', label: 'Лёгкий', hint: '1-3 раза/нед' },
  { value: 'moderate', label: 'Средний', hint: '3-5 раз/нед' },
  { value: 'active', label: 'Активный', hint: 'почти каждый день' },
  { value: 'very_active', label: 'Очень активный', hint: 'спорт + работа' },
]

interface NutritionProfileSurveyProps {
  open: boolean
  initialProfile: NutritionProfile | null
  saving?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (profile: NutritionProfileInput) => Promise<void> | void
}

export function NutritionProfileSurvey({
  open,
  initialProfile,
  saving = false,
  onOpenChange,
  onSubmit,
}: NutritionProfileSurveyProps) {
  const [form, setForm] = useState<NutritionProfileInput>(profileToInput(initialProfile))

  useEffect(() => {
    if (open) setForm(profileToInput(initialProfile))
  }, [initialProfile, open])

  const setField = <K extends keyof NutritionProfileInput>(key: K, value: NutritionProfileInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit({
      ...form,
      age: clamp(Math.round(form.age), 10, 100),
      heightCm: clamp(form.heightCm, 100, 250),
      weightKg: clamp(form.weightKg, 30, 300),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[28px] border-white/15 bg-background/95 p-0 shadow-2xl backdrop-blur-2xl sm:max-w-[560px]">
        <form onSubmit={handleSubmit}>
          <div className="p-5 sm:p-6">
            <DialogHeader className="text-left">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Target className="h-5 w-5" />
              </div>
              <DialogTitle className="text-xl">Настроим твою норму</DialogTitle>
              <DialogDescription>
                Короткий опрос сохранится в аккаунте и пересчитает калории, белки, жиры и углеводы под тебя.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-5">
              <section>
                <Label className="mb-2 block">Цель</Label>
                <div className="grid grid-cols-3 gap-2">
                  {GOALS.map((item) => (
                    <OptionButton
                      key={item.value}
                      active={form.goal === item.value}
                      label={item.label}
                      hint={item.hint}
                      onClick={() => setField('goal', item.value)}
                    />
                  ))}
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-2 block">Пол для расчёта</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <OptionButton
                      active={form.sex === 'male'}
                      label="М"
                      hint="муж."
                      onClick={() => setField('sex', 'male')}
                    />
                    <OptionButton
                      active={form.sex === 'female'}
                      label="Ж"
                      hint="жен."
                      onClick={() => setField('sex', 'female')}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="nutrition-age" className="mb-2 block">Возраст</Label>
                  <Input
                    id="nutrition-age"
                    type="number"
                    min={10}
                    max={100}
                    inputMode="numeric"
                    value={form.age}
                    onChange={(event) => setField('age', numberValue(event.currentTarget.value))}
                  />
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="nutrition-height" className="mb-2 block">Рост, см</Label>
                  <Input
                    id="nutrition-height"
                    type="number"
                    min={100}
                    max={250}
                    inputMode="decimal"
                    value={form.heightCm}
                    onChange={(event) => setField('heightCm', numberValue(event.currentTarget.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="nutrition-weight" className="mb-2 block">Вес, кг</Label>
                  <Input
                    id="nutrition-weight"
                    type="number"
                    min={30}
                    max={300}
                    inputMode="decimal"
                    value={form.weightKg}
                    onChange={(event) => setField('weightKg', numberValue(event.currentTarget.value))}
                  />
                </div>
              </section>

              <section>
                <Label className="mb-2 flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Активность
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {ACTIVITIES.map((item) => (
                    <OptionButton
                      key={item.value}
                      active={form.activityLevel === item.value}
                      label={item.label}
                      hint={item.hint}
                      onClick={() => setField('activityLevel', item.value)}
                    />
                  ))}
                </div>
              </section>

              <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-3 text-xs text-muted-foreground">
                <Scale className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Это стартовая оценка для дневника. Если вес или цель меняются, открой профиль и пересчитай нормы.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-border/60 p-4 sm:p-5">
            <Button type="submit" className="w-full rounded-2xl" disabled={saving}>
              <Dumbbell className="h-4 w-4" />
              {saving ? 'Сохраняю...' : 'Сохранить нормы'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function OptionButton({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-2xl border px-3 py-2.5 text-left transition-all',
        active
          ? 'border-primary/70 bg-primary/10 text-foreground shadow-[0_10px_30px_rgba(99,102,241,0.14)]'
          : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted/70',
      )}
    >
      <span className="block text-sm font-semibold text-foreground">{label}</span>
      <span className="mt-0.5 block text-[11px] leading-tight">{hint}</span>
    </button>
  )
}

function profileToInput(profile: NutritionProfile | null): NutritionProfileInput {
  if (!profile) return DEFAULT_PROFILE
  return {
    sex: profile.sex,
    age: profile.age,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
  }
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
