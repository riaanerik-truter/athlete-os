import { useState, useEffect } from 'react'
import { useAthlete } from '../../context/AthleteContext.jsx'
import axios from 'axios'

const API_KEY = 'dev-local-key'

const STEPS = [
  {
    id: 'welcome',
    target: null,
    title: null,
    body: null,
    button: 'Start tour →',
    fullScreen: true,
  },
  {
    id: 'kpi',
    target: '[data-tour="kpi-cards"]',
    title: 'Your fitness dashboard',
    body: 'CTL shows your fitness, ATL your fatigue, TSB your form. Updated after every sync.',
    button: 'Next →',
  },
  {
    id: 'sessions',
    target: '[data-tour="session-list"]',
    title: 'This week',
    body: 'Your training week. Sessions update as you complete them. Drop activity files into the watched-activities folder to sync.',
    button: 'Next →',
  },
  {
    id: 'race',
    target: '[data-tour="race-prediction"]',
    title: 'Race prediction',
    body: 'Your race prediction updates as your fitness builds. Hover the ℹ icon to see the assumptions behind it.',
    button: 'Next →',
  },
  {
    id: 'chat',
    target: '[data-tour="chat-widget"]',
    title: 'Coach Ri',
    body: 'This is how you talk to me. Ask questions, log your diary, request knowledge summaries — I\'m always here.',
    button: 'Next →',
  },
  {
    id: 'knowledge',
    target: '[data-tour="nav-knowledge"]',
    title: 'Knowledge browser',
    body: 'Your personal sports science library. Add books, papers, and articles and I can summarise them for you.',
    button: 'Next →',
  },
  {
    id: 'settings',
    target: '[data-tour="nav-settings"]',
    title: 'Settings',
    body: 'Settings let you control how proactive I am, how much context I use, and which channels are active.',
    button: 'Start onboarding →',
  },
]

const WELCOME_MESSAGE = `Welcome to Athlete OS. I use Joe Friel's training methodology as my foundation — I recommend picking up The Triathlon Training Bible and High Performance Cyclist when you get a chance. They'll help you understand the reasoning behind my recommendations.

Before we set up your training profile, one question:
Would you prefer to do your onboarding here in the browser, or in Discord? Either works — just pick whichever feels more natural to you.`

function getTargetRect(selector) {
  if (!selector) return null
  const el = document.querySelector(selector)
  if (!el) return null
  return el.getBoundingClientRect()
}

function SpotlightOverlay({ rect, onSkip }) {
  if (!rect) {
    return (
      <div
        className="fixed inset-0 bg-black/70 z-40"
        style={{ backdropFilter: 'blur(2px)' }}
        onClick={onSkip}
      />
    )
  }

  const pad = 8
  const top    = rect.top    - pad
  const left   = rect.left   - pad
  const width  = rect.width  + pad * 2
  const height = rect.height + pad * 2

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {/* top */}
      <div className="absolute bg-black/70" style={{ top: 0, left: 0, right: 0, height: Math.max(0, top) }} />
      {/* bottom */}
      <div className="absolute bg-black/70" style={{ top: top + height, left: 0, right: 0, bottom: 0 }} />
      {/* left */}
      <div className="absolute bg-black/70" style={{ top, left: 0, width: Math.max(0, left), height }} />
      {/* right */}
      <div className="absolute bg-black/70" style={{ top, left: left + width, right: 0, height }} />
      {/* spotlight border */}
      <div
        className="absolute rounded-lg ring-2 ring-blue-400 ring-offset-0"
        style={{ top, left, width, height }}
      />
    </div>
  )
}

function TourCard({ step, stepIndex, totalSteps, rect, athleteName, onNext, onSkip }) {
  const isFullScreen = step.fullScreen
  const isLast = stepIndex === totalSteps - 1

  if (isFullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-10 max-w-md w-full mx-4 text-center shadow-2xl">
          <div className="text-4xl mb-4">🏅</div>
          <h2 className="text-2xl font-bold text-white mb-3">
            Welcome to Athlete OS{athleteName ? `, ${athleteName}` : ''}.
          </h2>
          <p className="text-gray-300 mb-2">
            I'm Coach Ri — your AI training coach built on Joe Friel's methodology.
          </p>
          <p className="text-gray-400 text-sm mb-8">Let me show you around.</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onSkip}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Skip tour
            </button>
            <button
              onClick={onNext}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
            >
              {step.button}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Position card below or above the spotlight
  const viewportH = window.innerHeight
  const cardH     = 180
  const pad        = 16

  let top  = rect ? rect.bottom + 16 + window.scrollY : viewportH / 2
  let left = rect ? Math.max(pad, rect.left + window.scrollX) : pad

  // Flip above if card would overflow bottom
  if (rect && rect.bottom + cardH + pad > viewportH) {
    top = rect.top + window.scrollY - cardH - 16
  }

  return (
    <div
      className="fixed z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-5 w-80"
      style={{ top, left }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500">
          Step {stepIndex} of {totalSteps - 1}
        </span>
        <button
          onClick={onSkip}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Skip
        </button>
      </div>
      <h3 className="text-white font-semibold mb-1">{step.title}</h3>
      <p className="text-gray-400 text-sm mb-4">{step.body}</p>
      <button
        onClick={onNext}
        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
      >
        {step.button}
      </button>
    </div>
  )
}

async function postWelcomeMessage() {
  try {
    await axios.post(
      '/api/v1/conversations',
      { role: 'coach', content: WELCOME_MESSAGE, channel: 'web' },
      { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' } }
    )
  } catch {
    // non-critical — tour completes regardless
  }
}

export default function WelcomeTour() {
  const { athlete } = useAthlete()
  const [active, setActive]   = useState(false)
  const [step, setStep]       = useState(0)
  const [rect, setRect]       = useState(null)

  useEffect(() => {
    if (!localStorage.getItem('athleteos_tour_completed')) {
      setActive(true)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const target = STEPS[step]?.target
    if (target) {
      const el = document.querySelector(target)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // small delay to let scroll settle before computing rect
        setTimeout(() => setRect(getTargetRect(target)), 300)
      } else {
        setRect(null)
      }
    } else {
      setRect(null)
    }
  }, [active, step])

  function complete() {
    localStorage.setItem('athleteos_tour_completed', 'true')
    setActive(false)
    postWelcomeMessage()
  }

  function handleNext() {
    if (step >= STEPS.length - 1) {
      complete()
    } else {
      setStep(s => s + 1)
    }
  }

  function handleSkip() {
    complete()
  }

  if (!active) return null

  const currentStep = STEPS[step]

  return (
    <>
      <SpotlightOverlay rect={rect} onSkip={handleSkip} />
      <TourCard
        step={currentStep}
        stepIndex={step}
        totalSteps={STEPS.length}
        rect={rect}
        athleteName={athlete?.name ?? ''}
        onNext={handleNext}
        onSkip={handleSkip}
      />
    </>
  )
}
