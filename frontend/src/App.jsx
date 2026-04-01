import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

import { ThemeProvider }  from './context/ThemeContext.jsx'
import { AthleteProvider } from './context/AthleteContext.jsx'

import Navbar        from './components/shared/Navbar.jsx'
import SettingsPanel from './components/shared/SettingsPanel.jsx'
import ChatWidget    from './components/shared/ChatWidget.jsx'

import Dashboard      from './pages/Dashboard.jsx'
import Knowledge      from './pages/Knowledge.jsx'
import Profile        from './pages/Profile.jsx'
import ResourceDetail from './components/knowledge/ResourceDetail.jsx'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <ThemeProvider>
      <AthleteProvider>
        <BrowserRouter>
          <div className="min-h-screen flex flex-col bg-white dark:bg-gray-900">

            <Navbar onSettingsOpen={() => setSettingsOpen(true)} />

            <div className="flex-1">
              <Routes>
                <Route path="/"                  element={<Dashboard />} />
                <Route path="/knowledge"         element={<Knowledge />} />
                <Route path="/knowledge/:id"     element={<ResourceDetail />} />
                <Route path="/profile"           element={<Profile />} />
              </Routes>
            </div>

            <SettingsPanel
              open={settingsOpen}
              onClose={() => setSettingsOpen(false)}
            />

            <ChatWidget />

          </div>
        </BrowserRouter>
      </AthleteProvider>
    </ThemeProvider>
  )
}
