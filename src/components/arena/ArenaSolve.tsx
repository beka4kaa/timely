"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SendIcon } from "lucide-react"
import { toast } from "sonner"

export function ArenaSolve() {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submitSolution = async (base64: string) => {
    setIsSubmitting(true)
    // Моковая задержка отправки
    await new Promise((resolve) => setTimeout(resolve, 1000))
    toast.success("Решение отправлено на проверку")
    setIsSubmitting(false)
  }

  return (
    <div className="flex flex-col h-full w-full gap-4 p-4 max-w-5xl mx-auto">
      {/* Условие задачи */}
      <Card className="w-full shrink-0 shadow-sm border-border">
        <CardHeader className="py-4">
          <CardTitle className="text-lg flex items-center gap-2">
            Task Condition
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Найдите производную функции f(x) = x^3 - 2x^2 + 5x - 7. Покажите все шаги вычисления.
          </p>
        </CardContent>
      </Card>

      {/* Заглушка интерактивной доски */}
      <Card className="flex-1 w-full bg-muted/30 border-dashed border-2 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center text-muted-foreground opacity-50">
          <span className="font-medium text-lg">[Интерактивная Доска]</span>
          <span className="text-sm">Тут будет Canvas для рисования</span>
        </div>
      </Card>

      {/* Панель отправки */}
      <div className="flex justify-end shrink-0 py-2">
        <Button 
          size="lg" 
          onClick={() => submitSolution("mock_base64_data")}
          disabled={isSubmitting}
          className="gap-2"
        >
          {isSubmitting ? "Отправка..." : "Отправить решение"}
          <SendIcon className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
