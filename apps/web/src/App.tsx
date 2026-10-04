import { useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, Outlet } from 'react-router-dom';
import { StdbProvider } from './lib/stdb';
import { Ops } from './routes/Ops';
import { Home } from './routes/Home';
import { WhatIf } from './routes/WhatIf';
import { Validation } from './routes/Validation';
import { MainNavigation, navigation } from './components/MainNavigation';

export function App() {
  const { pathname, search } = useLocation();
  const dark = pathname === '/ops';
  const pressureConsole = dark && new URLSearchParams(search).get('ui') !== 'gas';
  useEffect(() => {
    const page = navigation.find(({ to }) => to === pathname);
    document.title = `${page?.label ?? 'Welcome'} · BoreaFlux`;
  }, [pathname]);

  return (
    <div className={`app-shell ${dark ? 'theme-dark' : pathname === '/home' ? 'theme-light theme-household' : 'theme-light'} ${pressureConsole ? 'pressure-console-shell' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      {!pressureConsole && <header className="app-header">
        <NavLink className="brand" to="/ops">
          <img className="brand-logo" src="/borea-flux-logo.webp" alt="BoreaFlux" width={960} height={145} />
          <span className="brand-subtitle">Southcentral Alaska</span>
        </NavLink>
        <MainNavigation />
      </header>}
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
      {!pressureConsole && <footer className="app-footer">A simulated thermostat program for cold snaps. No real thermostats are controlled.</footer>}
    </div>
  );
}
