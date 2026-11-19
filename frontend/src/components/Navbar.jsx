import { Link, NavLink } from 'react-router-dom';

/**
 * Navbar — Top navigation bar for SmartRail.
 *
 * Displays brand logo and primary navigation links (Home, Search Trains).
 * Fully responsive and styled according to docs/DESIGN.md.
 */
export default function Navbar() {
  const navLinkStyle = ({ isActive }) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive
      ? 'text-[var(--color-primary)] font-semibold'
      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]'
    }`;

  return (
    <header className="bg-[var(--color-surface-card)] border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Brand Logo */}
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
              Smart<span className="text-[var(--color-primary)]">Rail</span>
            </span>
          </Link>

          {/* Navigation Links */}
          <nav className="flex items-center gap-4 sm:gap-6">
            <NavLink to="/" end className={navLinkStyle}>
              Home
            </NavLink>
            <NavLink to="/search" className={navLinkStyle}>
              Search Trains
            </NavLink>
          </nav>
        </div>
      </div>
    </header>
  );
}
