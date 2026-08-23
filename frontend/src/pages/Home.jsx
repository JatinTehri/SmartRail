import { Link } from 'react-router-dom';

/**
 * Home — placeholder landing page for SmartRail.
 * Will be replaced with the full search-focused landing page in later phases.
 */
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      {/* Hero */}
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-bold tracking-tight text-[var(--color-text-primary)] mb-4">
          Smart<span className="text-[var(--color-primary)]">Rail</span>
        </h1>

        <p className="text-lg text-[var(--color-text-secondary)] mb-8">
          Intelligent railway reservations with smart seat allocation.
          Search trains, book tickets, and enjoy a smarter travel experience.
        </p>

        <div className="flex gap-4 justify-center flex-wrap">
          <Link
            to="/search"
            className="inline-flex items-center gap-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] text-white font-semibold py-3 px-8 rounded-lg transition-colors duration-200 shadow-md"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            Search Trains
          </Link>
        </div>
      </div>

      {/* Feature highlights */}
      <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-4xl w-full">
        {[
          {
            title: 'Smart Allocation',
            description: 'Intelligent seat allocation that keeps groups together and respects preferences.',
            icon: '🧠',
          },
          {
            title: 'Fast Booking',
            description: 'Streamlined booking flow from search to confirmed PNR in seconds.',
            icon: '⚡',
          },
          {
            title: 'Passenger Safety',
            description: 'Safety-aware seating with female passenger and senior citizen preferences.',
            icon: '🛡️',
          },
        ].map((feature) => (
          <div
            key={feature.title}
            className="bg-[var(--color-surface-card)] rounded-xl p-6 shadow-sm border border-[var(--color-surface-muted)] hover:shadow-md transition-shadow duration-200"
          >
            <div className="text-3xl mb-3">{feature.icon}</div>
            <h3 className="font-semibold text-lg text-[var(--color-text-primary)] mb-1">{feature.title}</h3>
            <p className="text-sm text-[var(--color-text-muted)]">{feature.description}</p>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <p className="mt-16 text-xs text-[var(--color-text-muted)]">
        SmartRail — Portfolio Project
      </p>
    </div>
  );
}
