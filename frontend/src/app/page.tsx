'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

const communities = [
  {
    id: 'qa',
    name: 'QA Engineers',
    icon: '🎯',
    agent: 'QualityGPT',
    description: 'Test automation, scenarios, bug analysis and more',
    color: 'bg-blue-500',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-600'
  },
  {
    id: 'backend',
    name: 'Backend Developers',
    icon: '🔧',
    agent: 'BackendGPT',
    description: 'API design, database optimization, security and more',
    color: 'bg-green-500',
    borderColor: 'border-green-200',
    textColor: 'text-green-600'
  },
  {
    id: 'frontend',
    name: 'Frontend Developers',
    icon: '🎨',
    agent: 'FrontendGPT',
    description: 'React/Vue/Angular, mobile apps, responsive design and more',
    color: 'bg-purple-500',
    borderColor: 'border-purple-200',
    textColor: 'text-purple-600'
  },
  {
    id: 'design',
    name: 'UI/UX Designers',
    icon: '✨',
    agent: 'DesignGPT',
    description: 'Design systems, accessibility, user flows and more',
    color: 'bg-pink-500',
    borderColor: 'border-pink-200',
    textColor: 'text-pink-600'
  },
  {
    id: 'product',
    name: 'Product Managers',
    icon: '📊',
    agent: 'ProductGPT',
    description: 'Requirements, user stories, roadmaps and more',
    color: 'bg-orange-500',
    borderColor: 'border-orange-200',
    textColor: 'text-orange-600'
  },
  {
    id: 'devops',
    name: 'DevOps Engineers',
    icon: '🔐',
    agent: 'OpsGPT',
    description: 'CI/CD, infrastructure, monitoring and more',
    color: 'bg-red-500',
    borderColor: 'border-red-200',
    textColor: 'text-red-600'
  },
  {
    id: 'analyst',
    name: 'Business System Analysts',
    icon: '�',
    agent: 'AnalystGPT',
    description: 'Requirements analysis and process optimization',
    color: 'bg-indigo-500',
    borderColor: 'border-indigo-200',
    textColor: 'text-indigo-600'
  }
]

export default function HomePage() {
  const [activeSection, setActiveSection] = useState<string>('hero')
  const [animationDirection, setAnimationDirection] = useState<'down' | 'up'>('down')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const sections = ['hero', 'communities', 'about']

  const handleSectionChange = (section: string, direction?: 'down' | 'up') => {
    const currentIndex = sections.indexOf(activeSection)
    const newIndex = sections.indexOf(section)
    
    if (direction) {
      setAnimationDirection(direction)
    } else {
      setAnimationDirection(newIndex > currentIndex ? 'down' : 'up')
    }
    
    setActiveSection(section)
  }

  // Scroll-based navigation
  useEffect(() => {
    // Check authentication status
    const token = localStorage.getItem('token')
    const userStr = localStorage.getItem('user')
    
    if (token && userStr) {
      try {
        JSON.parse(userStr) // Validate JSON
        setIsAuthenticated(true)
      } catch (e) {
        // Invalid user data
        setIsAuthenticated(false)
      }
    }

    // Enable body scrolling to allow scrolling within sections
    document.body.style.overflow = 'auto'
    
    // Prevent browser back/forward navigation on horizontal swipe
    const preventBrowserNavigation = (e: WheelEvent) => {
      // Block horizontal scrolling that could trigger browser back/forward
      if (Math.abs(e.deltaX) > 0) {
        e.preventDefault()
      }
    }
    
    // Add to document to catch all horizontal scrolls
    document.addEventListener('wheel', preventBrowserNavigation, { passive: false })
    
    let isScrolling = false
    let scrollTimeout: NodeJS.Timeout
    let scrollAccumulator = 0
    const scrollThreshold = 100 // Require more scroll distance before changing sections

    const handleWheel = (e: WheelEvent) => {
      // Only handle horizontal scrolling for section changes
      // Allow vertical scrolling to work normally within sections
      const isHorizontalScroll = Math.abs(e.deltaX) > Math.abs(e.deltaY)
      
      // Always prevent default for horizontal scrolling to block browser back/forward navigation
      if (isHorizontalScroll) {
        e.preventDefault()
      }
      
      if (!isHorizontalScroll) {
        // Allow vertical scrolling within the section
        return
      }
      
      if (isScrolling) return
      
      // Accumulate horizontal scroll delta only
      scrollAccumulator += e.deltaX
      
      // Only change section if threshold is exceeded
      if (Math.abs(scrollAccumulator) < scrollThreshold) {
        return
      }
      
      const currentIndex = sections.indexOf(activeSection)
      let newIndex = currentIndex

      if (scrollAccumulator > 0) {
        // Scroll right - next section
        newIndex = Math.min(currentIndex + 1, sections.length - 1)
        if (newIndex !== currentIndex) {
          setAnimationDirection('down') // 'down' now means 'right'
        }
      } else {
        // Scroll left - previous section
        newIndex = Math.max(currentIndex - 1, 0)
        if (newIndex !== currentIndex) {
          setAnimationDirection('up') // 'up' now means 'left'
        }
      }

      if (newIndex !== currentIndex) {
        isScrolling = true
        scrollAccumulator = 0 // Reset accumulator
        setActiveSection(sections[newIndex])
        
        // Reset scrolling flag after animation with longer debounce
        clearTimeout(scrollTimeout)
        scrollTimeout = setTimeout(() => {
          isScrolling = false
        }, 600) // Reduced for better button responsiveness
      } else {
        // Reset accumulator if we can't go further
        scrollAccumulator = 0
      }
    }

    // Add wheel event listener - passive: false only for horizontal scroll prevention
    window.addEventListener('wheel', handleWheel, { passive: false })

    // Touch/swipe support for mobile
    let touchStartX = 0
    let touchStartY = 0
    let touchEndX = 0
    let touchEndY = 0

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.changedTouches[0].screenX
      touchStartY = e.changedTouches[0].screenY
    }

    const handleTouchEnd = (e: TouchEvent) => {
      if (isScrolling) return
      
      touchEndX = e.changedTouches[0].screenX
      touchEndY = e.changedTouches[0].screenY
      const deltaX = touchStartX - touchEndX
      const deltaY = touchStartY - touchEndY
      const minSwipeDistance = 80 // Increased to distinguish from scrolling

      // Only handle horizontal swipes for section changes
      const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY)
      
      if (!isHorizontal || Math.abs(deltaX) < minSwipeDistance) {
        // Allow vertical scrolling within section
        return
      }

      const currentIndex = sections.indexOf(activeSection)
      let newIndex = currentIndex

      if (deltaX > 0) {
        // Swipe left - next section
        newIndex = Math.min(currentIndex + 1, sections.length - 1)
        if (newIndex !== currentIndex) {
          setAnimationDirection('down')
        }
      } else {
        // Swipe right - previous section
        newIndex = Math.max(currentIndex - 1, 0)
        if (newIndex !== currentIndex) {
          setAnimationDirection('up')
        }
      }

      if (newIndex !== currentIndex) {
        isScrolling = true
        setActiveSection(sections[newIndex])
        
        clearTimeout(scrollTimeout)
        scrollTimeout = setTimeout(() => {
          isScrolling = false
        }, 600) // Match wheel handler timeout
      }
    }

    window.addEventListener('touchstart', handleTouchStart)
    window.addEventListener('touchend', handleTouchEnd)

    // Keyboard navigation
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isScrolling) return
      
      const currentIndex = sections.indexOf(activeSection)
      let newIndex = currentIndex

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        newIndex = Math.min(currentIndex + 1, sections.length - 1)
        if (newIndex !== currentIndex) {
          setAnimationDirection('down')
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        newIndex = Math.max(currentIndex - 1, 0)
        if (newIndex !== currentIndex) {
          setAnimationDirection('up')
        }
      }

      if (newIndex !== currentIndex) {
        isScrolling = true
        setActiveSection(sections[newIndex])
        
        clearTimeout(scrollTimeout)
        scrollTimeout = setTimeout(() => {
          isScrolling = false
        }, 600) // Match wheel handler timeout
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      // Cleanup event listeners
      document.removeEventListener('wheel', preventBrowserNavigation)
      window.removeEventListener('wheel', handleWheel)
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('keydown', handleKeyDown)
      clearTimeout(scrollTimeout)
    }
  }, [activeSection, sections])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-surface-900">
      {/* Enhanced Navigation Header */}
      <Header 
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
      />

      {/* Carousel Content */}
      <main className="min-h-screen relative">
        {/* Section Indicator */}
        <div className="fixed right-6 top-1/2 transform -translate-y-1/2 z-40 hidden md:flex flex-col space-y-3">
          {sections.map((section, index) => (
            <button
              key={section}
              onClick={() => handleSectionChange(section)}
              className={`w-3 h-3 rounded-full transition-all duration-300 ${
                activeSection === section
                  ? 'bg-blue-600 scale-125'
                  : 'bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500'
              }`}
              title={section === 'hero' ? 'Home' : section === 'communities' ? 'Explore Communities' : 'Learn More'}
            />
          ))}
        </div>

        {/* Scroll Hints */}
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 transform -translate-x-1/2 z-40 text-center">
          <div className="flex items-center space-x-4 text-gray-500 dark:text-gray-400">
            {activeSection !== sections[0] && (
              <div className="animate-pulse">
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </div>
            )}
            <span className="text-[10px] sm:text-xs font-medium px-2">
              {activeSection === 'hero' && 'Swipe right or use arrow keys to explore'}
              {activeSection === 'communities' && 'Swipe left/right to navigate sections'}
              {activeSection === 'about' && 'Swipe left or use arrow keys to go back'}
            </span>
            {activeSection !== sections[sections.length - 1] && (
              <div className="animate-pulse">
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            )}
          </div>
        </div>
        {/* Hero Section */}
        {(activeSection === 'hero' || !activeSection) && (
          <section className={`bg-white dark:bg-surface-800 px-4 sm:px-6 py-12 sm:py-16 min-h-screen flex items-center ${
            animationDirection === 'down' ? 'animate-slideInFromRight' : 'animate-slideInFromLeft'
          }`}>
            <div className="max-w-7xl mx-auto text-center w-full pb-20">
              <div className="flex flex-col sm:flex-row items-center justify-center space-y-3 sm:space-y-0 sm:space-x-3 mb-6">
                <span className="text-3xl sm:text-4xl">🚀</span>
                <div>
                  <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
                    Welcome to UnifiedWork
                  </h1>
                  <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-2">
                    AI-Powered Unified Workspace for Tech Teams
                  </p>
                </div>
              </div>
              <p className="text-sm sm:text-base md:text-lg text-gray-600 dark:text-gray-400 max-w-3xl mx-auto mb-6 sm:mb-8 px-4">
                Choose your community and start working with your specialized AI assistant
              </p>
              
              {/* Navigation Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 max-w-2xl mx-auto mt-8 sm:mt-12 px-4">
                <button
                  onClick={() => handleSectionChange('communities')}
                  className="group bg-gradient-to-r from-blue-500 to-purple-600 text-white p-5 sm:p-6 rounded-xl hover:shadow-lg transition-all duration-300 hover:scale-105"
                >
                  <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">🏘️</div>
                  <h3 className="text-base sm:text-lg font-bold mb-2">Explore Communities</h3>
                  <p className="text-xs sm:text-sm text-blue-100">Discover specialized AI agents for your role</p>
                  <div className="mt-4 flex items-center justify-center">
                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>

                <button
                  onClick={() => handleSectionChange('about')}
                  className="group bg-gradient-to-r from-green-500 to-teal-600 text-white p-5 sm:p-6 rounded-xl hover:shadow-lg transition-all duration-300 hover:scale-105"
                >
                  <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">🎯</div>
                  <h3 className="text-base sm:text-lg font-bold mb-2">Learn More</h3>
                  <p className="text-xs sm:text-sm text-green-100">Discover how AI enhances team collaboration</p>
                  <div className="mt-4 flex items-center justify-center">
                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              </div>

              {/* Welcome Footer */}
              <div className="mt-12 sm:mt-16 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl p-5 sm:p-6 max-w-4xl mx-auto">
                <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-3">
                  🎊 Welcome to the Future of Tech Collaboration
                </h3>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                  You're not just using software - you're experiencing the future of tech collaboration. 
                  Each AI agent is specialized for your role, trained on best practices, and ready to help you excel.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-6 text-[10px] sm:text-xs">
                  <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
                    <span className="text-lg">🚀</span>
                    <span className="font-medium">Start small</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
                    <span className="text-lg">📦</span>
                    <span className="font-medium">Ship fast</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
                    <span className="text-lg">✨</span>
                    <span className="font-medium">Make it awesome</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
        {/* Communities Section */}
        {activeSection === 'communities' && (
          <section className={`bg-white dark:bg-surface-800 px-4 sm:px-6 py-12 sm:py-16 min-h-screen ${
            animationDirection === 'down' ? 'animate-slideInFromRight' : 'animate-slideInFromLeft'
          }`}>
            <div className="max-w-7xl mx-auto pb-20">
              <div className="text-center mb-8 sm:mb-12">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4">
                  🏘️ Discover Our Communities
                </h2>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 max-w-2xl mx-auto px-4">
                  Each community has a specialized AI agent ready to help you excel in your role
                </p>
                <div className="mt-4">
                  <Link
                    href={isAuthenticated ? "/dashboard" : "/login"}
                    className="inline-flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors duration-200"
                  >
                    {isAuthenticated ? "Go to dashboard" : "Sign in to get started"}
                    <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>

              {/* Communities Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 mb-8 sm:mb-12">
                {communities.map((community) => (
                  <div
                    key={community.id}
                    className="bg-white dark:bg-surface-800 border-2 border-gray-200 dark:border-gray-600 rounded-xl p-4 sm:p-5 shadow-md hover:shadow-xl transition-all duration-200"
                  >
                    <div className="flex items-center space-x-3 mb-3">
                      <div className={`w-10 h-10 sm:w-11 sm:h-11 ${community.color} rounded-lg flex items-center justify-center text-xl sm:text-2xl`}>
                        {community.icon}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white text-xs sm:text-sm">
                          {community.name}
                        </h3>
                        <p className={`text-[10px] sm:text-xs font-medium ${community.textColor}`}>
                          {community.agent}
                        </p>
                      </div>
                    </div>
                    
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-3">
                      {community.description}
                    </p>
                    
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-500 italic">
                        Sign in and access User Dashboard to start chatting with {community.agent}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </section>
        )}

        {/* About Section */}
        {activeSection === 'about' && (
          <section className={`bg-white dark:bg-surface-800 px-4 sm:px-6 py-12 sm:py-16 min-h-screen ${
            animationDirection === 'down' ? 'animate-slideInFromRight' : 'animate-slideInFromLeft'
          }`}>
            <div className="max-w-7xl mx-auto pb-20">
              <div className="text-center mb-8 sm:mb-12">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4">
                  🎯 Your Mission
                </h2>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 max-w-2xl mx-auto px-4">
                  UnifiedWork is not just a platform - it's a vision of how tech teams should work together, enhanced by AI
                </p>
              </div>

              <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 text-xs sm:text-sm mb-8 sm:mb-12">
                <div className="bg-white dark:bg-surface-800 p-4 sm:p-5 rounded-lg border border-gray-200 dark:border-gray-600 text-center">
                  <div className="text-xl sm:text-2xl mb-2">👨‍💻</div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1.5 text-xs sm:text-sm">Developers</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs">Get instant code help and architecture guidance</p>
                </div>
                <div className="bg-white dark:bg-surface-800 p-4 sm:p-5 rounded-lg border border-gray-200 dark:border-gray-600 text-center">
                  <div className="text-xl sm:text-2xl mb-2">🎨</div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1.5 text-xs sm:text-sm">Designers</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs">Design system guidance and UX best practices</p>
                </div>
                <div className="bg-white dark:bg-surface-800 p-4 sm:p-5 rounded-lg border border-gray-200 dark:border-gray-600 text-center">
                  <div className="text-xl sm:text-2xl mb-2">🧪</div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1.5 text-xs sm:text-sm">QA Engineers</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs">Test automation and quality processes</p>
                </div>
                <div className="bg-white dark:bg-surface-800 p-4 sm:p-5 rounded-lg border border-gray-200 dark:border-gray-600 text-center">
                  <div className="text-xl sm:text-2xl mb-2">📊</div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1.5 text-xs sm:text-sm">Product Managers</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs">Requirements and roadmap assistance</p>
                </div>
                <div className="bg-white dark:bg-surface-800 p-4 sm:p-5 rounded-lg border border-gray-200 dark:border-gray-600 text-center">
                  <div className="text-xl sm:text-2xl mb-2">🤝</div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1.5 text-xs sm:text-sm">Teams</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs">Collaborate seamlessly across disciplines</p>
                </div>
                <div className="bg-white dark:bg-surface-800 p-4 sm:p-5 rounded-lg border border-gray-200 dark:border-gray-600 text-center">
                  <div className="text-xl sm:text-2xl mb-2">🚀</div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1.5 text-xs sm:text-sm">Productivity</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs">AI makes everyone 10x more productive</p>
                </div>
              </div>

            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  )
}
