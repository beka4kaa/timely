"use client"

import { createContext, useCallback, useContext, useState } from "react"

interface DiaryHeaderActions {
    onTemplate: (() => void) | null
    onShortcuts: (() => void) | null
    onUndo: (() => void) | null
    onRedo: (() => void) | null
    canUndo: boolean
    canRedo: boolean
    applyingTemplate: boolean
}

const defaultActions: DiaryHeaderActions = {
    onTemplate: null,
    onShortcuts: null,
    onUndo: null,
    onRedo: null,
    canUndo: false,
    canRedo: false,
    applyingTemplate: false,
}

const DiaryHeaderCtx = createContext<{
    actions: DiaryHeaderActions
    register: (a: Partial<DiaryHeaderActions>) => void
    unregister: () => void
}>({
    actions: defaultActions,
    register: () => { },
    unregister: () => { },
})

export function DiaryHeaderProvider({ children }: { children: React.ReactNode }) {
    const [actions, setActions] = useState<DiaryHeaderActions>(defaultActions)

    const register = useCallback((a: Partial<DiaryHeaderActions>) => {
        setActions(prev => ({ ...prev, ...a }))
    }, [])

    const unregister = useCallback(() => {
        setActions(defaultActions)
    }, [])

    return (
        <DiaryHeaderCtx.Provider value={{ actions, register, unregister }}>
            {children}
        </DiaryHeaderCtx.Provider>
    )
}

export function useDiaryHeader() {
    return useContext(DiaryHeaderCtx)
}
