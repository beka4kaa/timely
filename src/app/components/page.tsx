"use client"

import Link from 'next/link'
import { Button } from '@/components/ui/button'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ThemeToggle } from '@/components/theme-toggle'
import { ArrowLeft, Calendar, Clock, BarChart3, Users, Settings, Bell } from 'lucide-react'
import { AnimatedSection, FadeInUp, ScaleIn } from '@/components/animated-elements'
import { EnhancedFooter } from '@/components/enhanced-footer'
import { motion } from 'framer-motion'

export default function ComponentsPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Background Pattern */}
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
      </div>

      {/* Header */}
      <motion.header 
        className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <motion.div 
              className="flex items-center gap-4"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Button variant="ghost" size="sm" asChild>
                <Link href="/">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Link>
              </Button>
              <h1 className="text-xl font-semibold">
                Components
              </h1>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <ThemeToggle />
            </motion.div>
          </div>
        </div>
      </motion.header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-16">
        <AnimatedSection>
          <div className="text-center mb-16">
            <div className="space-y-4">
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <Badge variant="secondary" className="mb-2">
                  UI Components
                </Badge>
              </motion.div>
              <FadeInUp delay={0.3}>
                <h2 className="text-3xl font-bold tracking-tight">
                  shadcn/ui Components
                </h2>
              </FadeInUp>
              <FadeInUp delay={0.5}>
                <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                  Explore the building blocks of our design system
                </p>
              </FadeInUp>
            </div>
          </div>
        </AnimatedSection>

        {/* Components Grid */}
        <AnimatedSection delay={0.2}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Button Card */}
            <ScaleIn delay={0.1}>
              <motion.div
                whileHover={{ y: -5 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="relative group">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <motion.div
                        whileHover={{ rotate: 360 }}
                        transition={{ duration: 0.5 }}
                      >
                        <Settings className="w-5 h-5" />
                      </motion.div>
                      Button
                    </CardTitle>
                    <CardDescription>
                      Clickable button component with multiple variants
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button size="sm">Primary</Button>
                      </motion.div>
                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button variant="secondary" size="sm">Secondary</Button>
                      </motion.div>
                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button variant="outline" size="sm">Outline</Button>
                      </motion.div>
                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button variant="ghost" size="sm">Ghost</Button>
                      </motion.div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </ScaleIn>

            {/* Badge Card */}
            <ScaleIn delay={0.2}>
              <motion.div
                whileHover={{ y: -5 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="relative group">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <motion.div
                        animate={{ 
                          rotate: [0, 10, -10, 0]
                        }}
                        transition={{ 
                          duration: 2, 
                          repeat: Infinity, 
                          ease: "easeInOut" 
                        }}
                      >
                        <Bell className="w-5 h-5" />
                      </motion.div>
                      Badge
                    </CardTitle>
                    <CardDescription>
                      Small status descriptors for UI elements
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <motion.div whileHover={{ scale: 1.1 }}>
                        <Badge>Default</Badge>
                      </motion.div>
                      <motion.div whileHover={{ scale: 1.1 }}>
                        <Badge variant="secondary">Secondary</Badge>
                      </motion.div>
                      <motion.div whileHover={{ scale: 1.1 }}>
                        <Badge variant="outline">Outline</Badge>
                      </motion.div>
                      <motion.div whileHover={{ scale: 1.1 }}>
                        <Badge variant="destructive">Destructive</Badge>
                      </motion.div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </ScaleIn>

            {/* Separator Card */}
            <ScaleIn delay={0.3}>
              <motion.div
                whileHover={{ y: -5 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="relative group">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="w-5 h-5" />
                      Separator
                    </CardTitle>
                    <CardDescription>
                      Visually separate content sections
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-sm">Section one</div>
                    <Separator />
                    <div className="text-sm">Section two</div>
                  </CardContent>
                </Card>
              </motion.div>
            </ScaleIn>

            {/* Theme Toggle Card */}
            <ScaleIn delay={0.4}>
              <motion.div
                whileHover={{ y: -5 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="relative group">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                      >
                        <Settings className="w-5 h-5" />
                      </motion.div>
                      Theme Toggle
                    </CardTitle>
                    <CardDescription>
                      Switch between light and dark themes
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ThemeToggle />
                  </CardContent>
                </Card>
              </motion.div>
            </ScaleIn>

            {/* More Components Card */}
            <ScaleIn delay={0.5}>
              <motion.div
                whileHover={{ y: -5 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="relative group">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <motion.div
                        whileHover={{ rotate: 180 }}
                        transition={{ duration: 0.3 }}
                      >
                        <Users className="w-5 h-5" />
                      </motion.div>
                      More Components
                    </CardTitle>
                    <CardDescription>
                      Explore additional shadcn/ui components
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/dashboard">
                          View Dashboard
                        </Link>
                      </Button>
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            </ScaleIn>
          </div>
        </AnimatedSection>

        <AnimatedSection>
          <Separator className="my-16" />
        </AnimatedSection>

        {/* Features */}
        <AnimatedSection delay={0.1}>
          <div className="text-center space-y-8">
            <FadeInUp>
              <div>
                <h3 className="text-2xl font-semibold mb-3">More Features</h3>
                <p className="text-muted-foreground">Additional components and patterns</p>
              </div>
            </FadeInUp>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
              {[
                { icon: Calendar, label: "Calendar", delay: 0.1 },
                { icon: Clock, label: "Time Picker", delay: 0.2 },
                { icon: BarChart3, label: "Charts", delay: 0.3 },
                { icon: Users, label: "Avatar", delay: 0.4 },
                { icon: Settings, label: "Settings", delay: 0.5 },
                { icon: Bell, label: "Notifications", delay: 0.6 }
              ].map((item) => {
                const IconComponent = item.icon
                return (
                  <ScaleIn key={item.label} delay={item.delay}>
                    <motion.div 
                      className="flex flex-col items-center space-y-2 p-4 rounded-lg bg-muted/50"
                      whileHover={{ 
                        scale: 1.05,
                        backgroundColor: "hsl(var(--primary) / 0.1)"
                      }}
                      transition={{ duration: 0.2 }}
                    >
                      <motion.div
                        whileHover={{ 
                          rotate: 360,
                          scale: 1.2
                        }}
                        transition={{ duration: 0.5 }}
                      >
                        <IconComponent className="w-6 h-6 text-primary" />
                      </motion.div>
                      <span className="text-sm font-medium">{item.label}</span>
                    </motion.div>
                  </ScaleIn>
                )
              })}
            </div>
          </div>
        </AnimatedSection>

        <AnimatedSection>
          <Separator className="my-16" />
        </AnimatedSection>

        {/* CTA */}
        <AnimatedSection delay={0.2}>
          <div className="text-center">
            <FadeInUp>
              <h3 className="text-2xl font-semibold mb-4">Ready to build?</h3>
            </FadeInUp>
            <FadeInUp delay={0.2}>
              <p className="text-muted-foreground mb-6">
                Start creating with our comprehensive component library
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
                  Get Started
                </Link>
              </Button>
            </motion.div>
          </div>
        </AnimatedSection>
      </main>
      
      <EnhancedFooter />
    </div>
  )
}