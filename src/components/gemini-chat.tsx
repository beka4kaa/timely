"use client"

import { useState, useRef, useEffect } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  MessageCircle, 
  Send, 
  Minimize2, 
  Maximize2, 
  X,
  Sparkles,
  Bot,
  User,
  Trash2,
  Settings
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  content: string
  isUser: boolean
  timestamp: Date
}

interface GeminiChatProps {
  apiKey?: string
}

export function GeminiChat({ apiKey }: GeminiChatProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content: 'Привет! 👋 Я Gemini AI, ваш персональный помощник по планированию!\n\n✨ Я могу:\n• Анализировать ваше расписание\n• Давать советы по продуктивности\n• Помогать планировать время\n• Предлагать улучшения\n\nПокажите мне ваше расписание или задайте любой вопрос! 🚀',
      isUser: false,
      timestamp: new Date()
    }
  ])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [currentApiKey, setCurrentApiKey] = useState('')
  const [showApiKeyInput, setShowApiKeyInput] = useState(true)
  const [lastUserMessage, setLastUserMessage] = useState('')
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const genAI = useRef<GoogleGenerativeAI | null>(null)

  // Автоскроллинг к последнему сообщению
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Загружаем API ключ при монтировании
  useEffect(() => {
    const initializeApiKey = async () => {
      // Сначала пробуем получить с сервера
      try {
        const response = await fetch('/api/gemini/config')
        if (response.ok) {
          const data = await response.json()
          if (data.apiKey) {
            setCurrentApiKey(data.apiKey)
            setShowApiKeyInput(false)
            return
          }
        }
      } catch (error) {
        console.log('Server API key not available, checking localStorage')
      }
      
      // Если не получилось с сервера, проверяем localStorage
      const savedApiKey = localStorage.getItem('gemini-api-key')
      if (savedApiKey) {
        setCurrentApiKey(savedApiKey)
        setShowApiKeyInput(false)
      }
    }
    
    initializeApiKey()
  }, [])

  useEffect(() => {
    if (currentApiKey) {
      genAI.current = new GoogleGenerativeAI(currentApiKey)
      localStorage.setItem('gemini-api-key', currentApiKey)
      setShowApiKeyInput(false)
    }
  }, [currentApiKey])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const getScreenContext = () => {
    // Получаем контекст экрана для Gemini
    const url = window.location.href
    const title = document.title
    
    // Определяем текущую страницу
    let currentPage = 'Неизвестная страница'
    if (url.includes('/schedule')) currentPage = 'Страница расписания'
    else if (url.includes('/dashboard')) currentPage = 'Панель управления'
    else if (url.includes('/calendar')) currentPage = 'Календарь'
    else if (url.includes('/tasks')) currentPage = 'Задачи'
    
    // Получаем события расписания если они есть
    const scheduleElement = document.querySelector('[data-schedule-content]')
    const events: string[] = []
    
    if (scheduleElement) {
      // Ищем блоки событий
      const eventBlocks = scheduleElement.querySelectorAll('[data-event-id]')
      eventBlocks.forEach(block => {
        const eventText = block.textContent?.trim()
        if (eventText && eventText.length > 0) {
          events.push(eventText)
        }
      })
      
      // Если событий нет, получаем общий контент
      if (events.length === 0) {
        const textContent = scheduleElement.textContent || ''
        if (textContent.includes('время') || textContent.includes('событие')) {
          events.push('Расписание пустое или события не найдены')
        }
      }
    }
    
    // Получаем время
    const currentTime = new Date().toLocaleString('ru-RU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })

    return `
КОНТЕКСТ ЭКРАНА ПОЛЬЗОВАТЕЛЯ:
📅 Текущее время: ${currentTime}
🖥️ Текущая страница: ${currentPage}
📋 События в расписании: ${events.length > 0 ? events.join(', ') : 'Нет событий'}

${events.length > 0 ? `
ДЕТАЛИ СОБЫТИЙ:
${events.map((event, index) => `${index + 1}. ${event}`).join('\n')}
` : ''}

Пользователь работает с системой планирования времени "Time Schedule Platform". 
Анализируйте его текущее расписание и давайте конкретные советы по улучшению продуктивности, 
организации времени и планирования. Отвечайте на русском языке.
    `.trim()
  }

  const sendMessage = async () => {
    if (!inputValue.trim() || !genAI.current) return

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue,
      isUser: true,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setLastUserMessage(inputValue)
    setInputValue('')
    setIsLoading(true)

    try {
      const model = genAI.current.getGenerativeModel({ model: "gemini-2.0-flash" })
      
      const context = getScreenContext()
      const prompt = `${context}\n\nВопрос пользователя: ${inputValue}\n\nОтвечай на русском языке, будь полезным и дружелюбным. Помоги с планированием и продуктивностью.`
      
      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: text,
        isUser: false,
        timestamp: new Date()
      }

      setMessages(prev => [...prev, aiMessage])
    } catch (error) {
      console.error('Ошибка Gemini API:', error)
      let errorText = 'Извините, произошла ошибка. '
      
      if (error instanceof Error) {
        if (error.message.includes('API_KEY_INVALID')) {
          errorText = '❌ Неверный API ключ. Проверьте ключ в настройках.'
        } else if (error.message.includes('QUOTA_EXCEEDED')) {
          errorText = '⚠️ Превышена квота API. Попробуйте позже.'
        } else if (error.message.includes('MODEL_NOT_FOUND')) {
          errorText = '🔍 Модель не найдена. Попробуйте обновить страницу.'
        } else {
          errorText += `Ошибка: ${error.message}`
        }
      } else {
        errorText += 'Проверьте интернет соединение и попробуйте позже.'
      }
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: errorText,
        isUser: false,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    }

    setIsLoading(false)
  }

  const retryLastMessage = () => {
    if (lastUserMessage && !isLoading) {
      setInputValue(lastUserMessage)
      sendMessage()
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('ru-RU', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 z-50"
        size="icon"
      >
        <Sparkles className="h-6 w-6" />
      </Button>
    )
  }

  return (
    <Card className={cn(
      "fixed bottom-6 right-6 w-96 shadow-2xl border-2 z-50 transition-all duration-300",
      isMinimized ? "h-16" : "h-[500px]",
      "bg-white/95 backdrop-blur-sm dark:bg-gray-900/95"
    )}>
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-full bg-gradient-to-r from-purple-500 to-blue-500">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Gemini AI</h3>
            <Badge variant="secondary" className="text-xs h-4 px-1.5">
              Помощник по планированию
            </Badge>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          {!isMinimized && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setMessages([{
                    id: '1',
                    content: 'Привет! 👋 Я Gemini AI, ваш персональный помощник по планированию!\n\n✨ Я могу:\n• Анализировать ваше расписание\n• Давать советы по продуктивности\n• Помогать планировать время\n• Предлагать улучшения\n\nПокажите мне ваше расписание или задайте любой вопрос! 🚀',
                    isUser: false,
                    timestamp: new Date()
                  }])
                }}
                title="Очистить историю"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setShowApiKeyInput(true)
                  setCurrentApiKey('')
                  localStorage.removeItem('gemini-api-key')
                }}
                title="Изменить API ключ"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsMinimized(!isMinimized)}
          >
            {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      {!isMinimized && (
        <CardContent className="flex flex-col h-[400px] p-4 pt-0">
          {showApiKeyInput ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
              <div className="p-3 rounded-full bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900/20 dark:to-blue-900/20">
                <Bot className="h-8 w-8 text-purple-600" />
              </div>
              <div>
                <h4 className="font-medium mb-2">Введите API ключ Gemini</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Получите ключ на ai.google.dev
                </p>
              </div>
              <div className="flex gap-2 w-full">
                <Input
                  placeholder="API ключ..."
                  type="password"
                  value={currentApiKey}
                  onChange={(e) => setCurrentApiKey(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && currentApiKey && setShowApiKeyInput(false)}
                />
                <Button 
                  onClick={() => setCurrentApiKey(currentApiKey)}
                  disabled={!currentApiKey}
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-3 text-sm",
                      message.isUser ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    <div className={cn(
                      "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                      message.isUser 
                        ? "bg-blue-500" 
                        : "bg-gradient-to-r from-purple-500 to-blue-500"
                    )}>
                      {message.isUser ? (
                        <User className="h-4 w-4 text-white" />
                      ) : (
                        <Bot className="h-4 w-4 text-white" />
                      )}
                    </div>
                    
                    <div className={cn(
                      "flex-1 space-y-1",
                      message.isUser ? "items-end" : "items-start"
                    )}>
                      <div className={cn(
                        "inline-block px-3 py-2 rounded-2xl max-w-[280px]",
                        message.isUser
                          ? "bg-blue-500 text-white ml-auto"
                          : "bg-gray-100 dark:bg-gray-800 text-foreground"
                      )}>
                        <div className="whitespace-pre-wrap break-words">
                          {message.content}
                        </div>
                      </div>
                      <div className={cn(
                        "text-xs text-muted-foreground px-1",
                        message.isUser ? "text-right" : "text-left"
                      )}>
                        {formatTime(message.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
                
                {isLoading && (
                  <div className="flex gap-3 text-sm">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="inline-block px-3 py-2 rounded-2xl bg-gray-100 dark:bg-gray-800">
                        <div className="flex items-center gap-1">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse delay-75"></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse delay-150"></div>
                          </div>
                          <span className="text-sm text-muted-foreground ml-2">Думаю...</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>

              {/* Быстрые кнопки */}
              {messages.length <= 1 && (
                <div className="grid grid-cols-1 gap-2 mb-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 justify-start"
                    onClick={() => setInputValue("Как улучшить моё расписание?")}
                  >
                    💡 Улучшить расписание
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 justify-start"
                    onClick={() => setInputValue("Проанализируй мою продуктивность")}
                  >
                    📊 Анализ продуктивности
                  </Button>
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  placeholder="Спросите об улучшении планирования..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={isLoading}
                  className="flex-1"
                />
                <Button 
                  onClick={sendMessage}
                  disabled={!inputValue.trim() || isLoading}
                  size="icon"
                  className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}