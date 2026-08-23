import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';

/**
 * Root application component.
 *
 * Sets up client-side routing via React Router.
 * Additional routes will be added as features are implemented.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {/* Future routes:
        <Route path="/search"   element={<TrainSearch />} />
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/booking/:pnr" element={<BookingDetails />} />
        ...
      */}
    </Routes>
  );
}
