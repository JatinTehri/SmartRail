import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import TrainSearch from './pages/TrainSearch';
import SeatAvailability from './pages/SeatAvailability';

/**
 * Root application component.
 *
 * Sets up client-side routing via React Router and common Navbar layout.
 */
export default function App() {
  return (
    <div className="min-h-screen bg-[var(--color-surface-bg)] flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<TrainSearch />} />
          <Route path="/trains/:trainId/availability" element={<SeatAvailability />} />
        </Routes>
      </main>
    </div>
  );
}
