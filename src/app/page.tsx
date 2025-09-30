"use client"

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ThemeToggle } from '@/components/theme-toggle'
import { Calendar, Clock, BarChart3, Star } from 'lucide-react'
import { AnimatedSection, FadeInUp, ScaleIn } from '@/components/animated-elements'
import { EnhancedFooter } from '@/components/enhanced-footer'
import { motion } from 'framer-motion'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Enhanced Background Pattern */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]"></div>
        <motion.div 
          className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-primary/5 opacity-20 blur-[100px]"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.2, 0.3, 0.2]
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <motion.div 
          className="absolute right-20 top-40 -z-10 h-[200px] w-[200px] rounded-full bg-primary/3 opacity-30 blur-[80px]"
          animate={{
            x: [0, 50, 0],
            y: [0, -30, 0]
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      </div>

      {/* Enhanced Header */}
      <motion.header 
        className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <motion.h1 
              className="text-xl font-semibold"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              Schedule
            </motion.h1>
            <motion.div 
              className="flex items-center gap-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <ThemeToggle />
              <Separator orientation="vertical" className="h-6" />
              <Button variant="outline" asChild>
                <Link href="/dashboard">
                  Dashboard
                </Link>
              </Button>
            </motion.div>
          </div>
        </div>
      </motion.header>

      {/* Enhanced Hero */}
      <main className="max-w-4xl mx-auto px-6">
        <div className="py-20 text-center space-y-8">
          <AnimatedSection delay={0.1}>
            <div className="space-y-4">
              <motion.div
                className="inline-flex items-center rounded-lg bg-muted px-3 py-1 text-sm font-medium gap-2"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.8 }}
              >
                <Star className="h-4 w-4" />
                Simple & Effective
              </motion.div>
              <FadeInUp delay={0.2}>
                <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
                  Simple time management
                </h2>
              </FadeInUp>
              <FadeInUp delay={0.4}>
                <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                  Track your time and manage your schedule with ease. 
                  <br className="hidden sm:inline" />
                  Built for productivity and simplicity.
                </p>
              </FadeInUp>
            </div>
          </AnimatedSection>
          <motion.div 
            className="flex gap-3 justify-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
          >
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button size="lg" asChild>
                <Link href="/dashboard">
                  Get started
                </Link>
              </Button>
            </motion.div>
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button variant="outline" size="lg" asChild>
                <Link href="/components">
                  Learn more
                </Link>
              </Button>
            </motion.div>
          </motion.div>
        </div>

        <AnimatedSection>
          <Separator className="my-16" />
        </AnimatedSection>

        {/* Enhanced Features */}
        <AnimatedSection delay={0.2}>
          <div className="py-16">
            <FadeInUp>
              <div className="text-center mb-12">
                <h3 className="text-2xl font-semibold mb-3">Everything you need</h3>
                <p className="text-muted-foreground">Simple tools for effective time management</p>
              </div>
            </FadeInUp>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <ScaleIn delay={0.1}>
                <motion.div 
                  className="relative group"
                  whileHover={{ y: -5 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-primary/10 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-300"></div>
                  <div className="relative text-center space-y-4 p-6 bg-card border rounded-lg">
                    <motion.div 
                      className="w-12 h-12 bg-primary/10 rounded-lg mx-auto flex items-center justify-center"
                      whileHover={{ rotate: 360, scale: 1.1 }}
                      transition={{ duration: 0.5 }}
                    >
                      <Calendar className="w-6 h-6 text-primary" />
                    </motion.div>
                    <h4 className="font-semibold">Schedule</h4>
                    <p className="text-sm text-muted-foreground">
                      Plan your day efficiently with smart scheduling tools
                    </p>
                  </div>
                </motion.div>
              </ScaleIn>
              
              <ScaleIn delay={0.2}>
                <motion.div 
                  className="relative group"
                  whileHover={{ y: -5 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-primary/10 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-300"></div>
                  <div className="relative text-center space-y-4 p-6 bg-card border rounded-lg">
                    <motion.div 
                      className="w-12 h-12 bg-primary/10 rounded-lg mx-auto flex items-center justify-center"
                      whileHover={{ rotate: 360, scale: 1.1 }}
                      transition={{ duration: 0.5 }}
                    >
                      <Clock className="w-6 h-6 text-primary" />
                    </motion.div>
                    <h4 className="font-semibold">Track</h4>
                    <p className="text-sm text-muted-foreground">
                      Monitor your progress and stay focused on goals
                    </p>
                  </div>
                </motion.div>
              </ScaleIn>
              
              <ScaleIn delay={0.3}>
                <motion.div 
                  className="relative group"
                  whileHover={{ y: -5 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-primary/10 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-300"></div>
                  <div className="relative text-center space-y-4 p-6 bg-card border rounded-lg">
                    <motion.div 
                      className="w-12 h-12 bg-primary/10 rounded-lg mx-auto flex items-center justify-center"
                      whileHover={{ rotate: 360, scale: 1.1 }}
                      transition={{ duration: 0.5 }}
                    >
                      <BarChart3 className="w-6 h-6 text-primary" />
                    </motion.div>
                    <h4 className="font-semibold">Analyze</h4>
                    <p className="text-sm text-muted-foreground">
                      Understand your patterns and optimize productivity
                    </p>
                  </div>
                </motion.div>
              </ScaleIn>
            </div>
          </div>
        </AnimatedSection>

        <AnimatedSection>
          <Separator className="my-16" />
        </AnimatedSection>
        
        {/* CTA Section */}
        <AnimatedSection delay={0.1}>
          <div className="text-center py-16">
            <div className="space-y-4">
              <FadeInUp>
                <h3 className="text-2xl font-semibold">Ready to get started?</h3>
              </FadeInUp>
              <FadeInUp delay={0.2}>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Join others who are already managing their time more effectively
                </p>
              </FadeInUp>
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.4 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button size="lg" asChild>
                  <Link href="/dashboard">
                    Start your journey
                  </Link>
                </Button>
              </motion.div>
            </div>
          </div>
        </AnimatedSection>
      </main>

      {/* Enhanced Footer */}
      <EnhancedFooter />
    </div>
  )
}