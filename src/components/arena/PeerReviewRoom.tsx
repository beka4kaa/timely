"use client"

import { useState } from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react"
import { toast } from "sonner"

export function PeerReviewRoom() {
  const [isVoting, setIsVoting] = useState(false)

  const handleVote = async (decision: 'correct' | 'incorrect' | 'spam') => {
    setIsVoting(true)
    // Моковая задержка запроса
    await new Promise((resolve) => setTimeout(resolve, 600))
    
    if (decision === 'correct') {
      toast.success("Вы проголосовали: Верно")
    } else if (decision === 'incorrect') {
      toast.error("Вы проголосовали: Неверно")
    } else {
      toast("Жалоба на спам отправлена")
    }
    
    // Загрузка следующей задачи (мод)
    setIsVoting(false)
  }

  return (
    <div className="flex flex-col h-full w-full relative max-w-7xl mx-auto">
      {/* Split View */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 pb-24 overflow-hidden">
        
        {/* Левая часть: Эталон */}
        <Card className="flex-1 flex flex-col shadow-sm border-border overflow-hidden">
          <CardHeader className="bg-muted/30 py-3 shrink-0">
            <CardTitle className="text-base text-primary flex items-center gap-2">
              Эталонное решение (от автора)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 overflow-auto flex-1 flex flex-col gap-4">
            <div className="p-3 bg-accent/50 rounded-md border text-sm">
              <span className="font-semibold block mb-1">Условие:</span>
              Найдите производную функции f(x) = x^3 - 2x^2 + 5x - 7.
            </div>
            
            {/* Заглушка эталонного решения */}
            <div className="flex-1 min-h-[300px] border border-dashed rounded-md bg-muted/20 flex items-center justify-center">
              <span className="text-muted-foreground text-sm">[Base64 Image Author Solution]</span>
            </div>
          </CardContent>
        </Card>

        {/* Правая часть: Решение студента */}
        <Card className="flex-1 flex flex-col shadow-sm border-border overflow-hidden">
          <CardHeader className="bg-muted/30 py-3 shrink-0">
            <CardTitle className="text-base text-orange-500 flex items-center gap-2">
              Решение студента
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 overflow-auto flex-1 flex flex-col">
            {/* Заглушка решения студента */}
            <div className="flex-1 min-h-[300px] border border-dashed rounded-md bg-muted/20 flex items-center justify-center">
              <span className="text-muted-foreground text-sm">[Base64 Image Student Solution]</span>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Панель голосования (Fixed Bottom) */}
      <div className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-md border-t p-4 flex justify-center items-center shadow-lg">
        <div className="flex gap-4 w-full max-w-2xl">
          <Button 
            variant="default" 
            className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-2 h-12 text-base"
            disabled={isVoting}
            onClick={() => handleVote('correct')}
          >
            <CheckCircle2 className="w-5 h-5" />
            Верно
          </Button>

          <Button 
            variant="destructive" 
            className="flex-1 gap-2 h-12 text-base"
            disabled={isVoting}
            onClick={() => handleVote('incorrect')}
          >
            <XCircle className="w-5 h-5" />
            Неверно
          </Button>

          <Button 
            variant="secondary" 
            className="flex-1 gap-2 h-12 text-base"
            disabled={isVoting}
            onClick={() => handleVote('spam')}
          >
            <AlertTriangle className="w-5 h-5" />
            Спам / Нарушение
          </Button>
        </div>
      </div>
    </div>
  )
}
