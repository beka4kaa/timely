"use client"

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Calendar, Clock, BarChart3, Github, Twitter, Mail, Heart, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { AnimatedSection, FadeInUp } from '@/components/animated-elements'

export function EnhancedFooter() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const footerLinks = {
    product: [
      { name: 'Features', href: '/components' },
      { name: 'Dashboard', href: '/dashboard' },
      { name: 'Pricing', href: '#' },
      { name: 'Updates', href: '#' }
    ],
    company: [
      { name: 'About', href: '#' },
      { name: 'Blog', href: '#' },
      { name: 'Careers', href: '#' },
      { name: 'Contact', href: '#' }
    ],
    resources: [
      { name: 'Documentation', href: '#' },
      { name: 'Help Center', href: '#' },
      { name: 'Community', href: '#' },
      { name: 'API Reference', href: '#' }
    ],
    legal: [
      { name: 'Privacy', href: '#' },
      { name: 'Terms', href: '#' },
      { name: 'Security', href: '#' },
      { name: 'Cookies', href: '#' }
    ]
  }

  const socialLinks = [
    { name: 'GitHub', icon: Github, href: '#', color: 'hover:text-gray-900 dark:hover:text-white' },
    { name: 'Twitter', icon: Twitter, href: '#', color: 'hover:text-blue-500' },
    { name: 'Email', icon: Mail, href: '#', color: 'hover:text-green-500' }
  ]

  return (
    <footer className="relative bg-background border-t">
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-muted/20 to-transparent pointer-events-none" />
      
      {/* Main footer content */}
      <div className="relative max-w-7xl mx-auto px-6 py-16">
        <AnimatedSection>
          <div className="grid grid-cols-1 lg:grid-cols-6 gap-8 lg:gap-12">
            {/* Brand section */}
            <div className="lg:col-span-2">
              <FadeInUp>
                <div className="space-y-4">
                  <motion.div 
                    className="flex items-center space-x-2"
                    whileHover={{ scale: 1.05 }}
                    transition={{ duration: 0.2 }}
                  >
                    <motion.div
                      animate={{ rotate: [0, 5, -5, 0] }}
                      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Calendar className="w-8 h-8 text-primary" />
                    </motion.div>
                    <span className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                      Schedule
                    </span>
                  </motion.div>
                  
                  <p className="text-muted-foreground text-sm leading-relaxed max-w-sm">
                    Simple and effective time management platform. 
                    Track your time, manage your schedule, and boost your productivity with ease.
                  </p>
                  
                  <div className="flex items-center space-x-4">
                    {socialLinks.map((social) => {
                      const IconComponent = social.icon
                      return (
                        <motion.a
                          key={social.name}
                          href={social.href}
                          className={`text-muted-foreground transition-colors ${social.color}`}
                          whileHover={{ scale: 1.1, y: -2 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <IconComponent className="w-5 h-5" />
                        </motion.a>
                      )
                    })}
                  </div>
                </div>
              </FadeInUp>
            </div>

            {/* Links sections */}
            <div className="lg:col-span-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                {/* Product */}
                <FadeInUp delay={0.1}>
                  <div>
                    <h3 className="font-semibold text-foreground mb-4 flex items-center">
                      <Clock className="w-4 h-4 mr-2 text-primary" />
                      Product
                    </h3>
                    <ul className="space-y-3">
                      {footerLinks.product.map((link) => (
                        <li key={link.name}>
                          <motion.div
                            whileHover={{ x: 2 }}
                            transition={{ duration: 0.2 }}
                          >
                            <Link
                              href={link.href}
                              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {link.name}
                            </Link>
                          </motion.div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </FadeInUp>

                {/* Company */}
                <FadeInUp delay={0.2}>
                  <div>
                    <h3 className="font-semibold text-foreground mb-4 flex items-center">
                      <BarChart3 className="w-4 h-4 mr-2 text-primary" />
                      Company
                    </h3>
                    <ul className="space-y-3">
                      {footerLinks.company.map((link) => (
                        <li key={link.name}>
                          <motion.div
                            whileHover={{ x: 2 }}
                            transition={{ duration: 0.2 }}
                          >
                            <Link
                              href={link.href}
                              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {link.name}
                            </Link>
                          </motion.div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </FadeInUp>

                {/* Resources */}
                <FadeInUp delay={0.3}>
                  <div>
                    <h3 className="font-semibold text-foreground mb-4">Resources</h3>
                    <ul className="space-y-3">
                      {footerLinks.resources.map((link) => (
                        <li key={link.name}>
                          <motion.div
                            whileHover={{ x: 2 }}
                            transition={{ duration: 0.2 }}
                          >
                            <Link
                              href={link.href}
                              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {link.name}
                            </Link>
                          </motion.div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </FadeInUp>

                {/* Legal */}
                <FadeInUp delay={0.4}>
                  <div>
                    <h3 className="font-semibold text-foreground mb-4">Legal</h3>
                    <ul className="space-y-3">
                      {footerLinks.legal.map((link) => (
                        <li key={link.name}>
                          <motion.div
                            whileHover={{ x: 2 }}
                            transition={{ duration: 0.2 }}
                          >
                            <Link
                              href={link.href}
                              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {link.name}
                            </Link>
                          </motion.div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </FadeInUp>
              </div>
            </div>
          </div>
        </AnimatedSection>

        {/* Newsletter section */}
        <AnimatedSection delay={0.2}>
          <div className="mt-12 pt-8 border-t">
            <div className="max-w-md mx-auto text-center">
              <FadeInUp>
                <h4 className="font-semibold text-foreground mb-2">Stay updated</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Get the latest updates and productivity tips delivered to your inbox.
                </p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="Enter your email"
                    className="flex-1 px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Button size="sm">Subscribe</Button>
                  </motion.div>
                </div>
              </FadeInUp>
            </div>
          </div>
        </AnimatedSection>

        {/* Bottom section */}
        <AnimatedSection delay={0.3}>
          <div className="mt-12 pt-8 border-t">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <FadeInUp>
                <div className="flex items-center text-sm text-muted-foreground">
                  <span>Made with</span>
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="mx-1"
                  >
                    <Heart className="w-4 h-4 text-red-500" />
                  </motion.div>
                  <span>using Next.js, TypeScript & shadcn/ui</span>
                </div>
              </FadeInUp>
              
              <div className="flex items-center gap-4">
                <FadeInUp delay={0.1}>
                  <p className="text-sm text-muted-foreground">
                    © 2025 Schedule. All rights reserved.
                  </p>
                </FadeInUp>
                
                <motion.button
                  onClick={scrollToTop}
                  className="p-2 rounded-full bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                  whileHover={{ scale: 1.1, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <ArrowUp className="w-4 h-4" />
                </motion.button>
              </div>
            </div>
          </div>
        </AnimatedSection>
      </div>

      {/* Decorative elements */}
      <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
    </footer>
  )
}