"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useSidebar } from "@/components/ui/sidebar"

/**
 * Dimming scrim shown behind the desktop off-canvas sidebar.
 * Fades in over the content area when the sidebar opens, blurs it slightly,
 * and closes the sidebar on click — the Apple/OpenAI drawer feel.
 * (Mobile already gets its own overlay from the Sheet component.)
 */
export function SidebarScrim() {
  const { open, isMobile, toggleSidebar } = useSidebar()
  const show = open && !isMobile

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={toggleSidebar}
          className="absolute inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
          aria-hidden
        />
      )}
    </AnimatePresence>
  )
}
