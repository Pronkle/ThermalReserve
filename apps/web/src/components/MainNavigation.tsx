import { NavLink } from 'react-router-dom';

export const navigation = [
  { to: '/ops', label: 'Operator console' },
  { to: '/home', label: 'Your home' },
  { to: '/whatif', label: 'What-if calculator' },
  { to: '/validation', label: 'Validation' },
];
export function MainNavigation() {
  return <nav aria-label="Main navigation" className="main-navigation">{navigation.map(({ to, label }) => <NavLink key={to} to={to}>{label}</NavLink>)}</nav>;
}
