import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import NovelDetail from './pages/NovelDetail'
import Preferences from './pages/Preferences'
import Recommendations from './pages/Recommendations'
import Settings from './pages/Settings'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/ConfirmDialog'
import ErrorBoundary from './components/ErrorBoundary'

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="novel/:id" element={<NovelDetail />} />
                <Route path="preferences" element={<Preferences />} />
                <Route path="recommendations" element={<Recommendations />} />
                <Route path="settings" element={<Settings />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}

export default App
