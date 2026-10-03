import { useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, Outlet } from 'react-router-dom';
import { StdbProvider } from './lib/stdb';
import { Ops } from './routes/Ops';
import { Home } from './routes/Home';
import { WhatIf } from './routes/WhatIf';
import { Validation } from './routes/Validation';

const navigation = [
  { to: '/ops', label: 'Operator console' },
  { to: '/home', label: 'Your home' },
  { to: '/whatif', label: 'What-if calculator' },
  { to: '/validation', label: 'Validation' },
];

export function App() {
  const { pathname } = useLocation();
  const dark = pathname === '/ops';
  useEffect(() => {
    const page = navigation.find(({ to }) => to === pathname);
    document.title = `${page?.label ?? 'Welcome'} · Thermal Reserve`;
  }, [pathname]);

  return (
    <div className={`app-shell ${dark ? 'theme-dark' : pathname === '/home' ? 'theme-light theme-household' : 'theme-light'}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="app-header">
        <NavLink className="brand" to="/ops" aria-label="Thermal Reserve operator console">
          <span className="brand-mark" aria-hidden="true">TR</span>
          <span>Thermal Reserve<span className="brand-subtitle">Southcentral Alaska</span></span>
        </NavLink>
        <nav aria-label="Main navigation" className="flex flex-wrap gap-2">
          {navigation.map(({ to, label }) => <NavLink key={to} to={to}>{label}</NavLink>)}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="page-content">
        <Routes>
          <Route path="/" element={<Navigate to="/ops" replace />} />
          <Route element={<StdbProvider><Outlet /></StdbProvider>}>
            <Route path="/ops" element={<Ops />} />
            <Route path="/home" element={<Home />} />
          </Route>
          <Route path="/whatif" element={<WhatIf />} />
          <Route path="/validation" element={<Validation />} />
          <Route path="*" element={<section className="panel"><h1>Page not found</h1><NavLink to="/ops">Open the operator console</NavLink></section>} />
        </Routes>
      </main>
      <footer className="app-footer">A simulated thermostat program for cold snaps. No real thermostats are controlled.</footer>
    </div>
  );
}
