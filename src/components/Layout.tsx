import { useState } from 'react'
import { Outlet, Link, useLocation, matchPath } from 'react-router-dom'

const navItems = [
  { path: '/', label: '小说列表', icon: '📚' },
  { path: '/preferences', label: '喜欢的小说', icon: '❤️' },
  { path: '/recommendations', label: '推荐', icon: '⭐' },
  { path: '/settings', label: '设置', icon: '⚙️' },
]

function isActive(currentPath: string, target: string): boolean {
  if (target === '/') {
    return currentPath === '/' || !!matchPath({ path: '/novel/:id', end: true }, currentPath)
  }
  return currentPath === target || currentPath.startsWith(target + '/')
}

export default function Layout() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b" aria-label="主导航">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-indigo-600">小说分析器</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={isActive(location.pathname, item.path) ? 'page' : undefined}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      isActive(location.pathname, item.path)
                        ? 'border-indigo-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`}
                  >
                    <span className="mr-2" aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="sm:hidden flex items-center">
              <button
                onClick={() => setMobileOpen(o => !o)}
                aria-expanded={mobileOpen}
                aria-label="切换菜单"
                className="p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              >
                {mobileOpen ? '✕' : '☰'}
              </button>
            </div>
          </div>
        </div>
        {mobileOpen && (
          <div className="sm:hidden border-t border-gray-200">
            <div className="pt-2 pb-3 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileOpen(false)}
                  className={`block pl-3 pr-4 py-2 text-base font-medium ${
                    isActive(location.pathname, item.path)
                      ? 'border-l-4 border-indigo-500 text-indigo-700 bg-indigo-50'
                      : 'border-l-4 border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  <span className="mr-2" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  )
}
