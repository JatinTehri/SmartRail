import { useState, useEffect, useRef } from 'react';
import api from '../services/api';

/**
 * StationSelect — Autocomplete dropdown input for railway stations.
 *
 * Calls GET /api/stations/search?q=... with a 300ms debounce.
 * Displays station code, name, and city in the suggestions dropdown.
 *
 * @param {object} props
 * @param {string} props.label - Field label (e.g. "From Station", "To Station")
 * @param {object|null} props.value - Currently selected station { id, code, name, city }
 * @param {function} props.onChange - Callback invoked when selection changes: (station | null) => void
 * @param {string} [props.placeholder] - Optional input placeholder
 */
export default function StationSelect({ label, value, onChange, placeholder = 'Search by name, city, or code...' }) {
  const [inputValue, setInputValue] = useState(value ? `${value.name} (${value.code})` : '');
  const [prevValue, setPrevValue] = useState(value);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const containerRef = useRef(null);

  // Sync internal input display text when parent updates `value` (e.g. on station swap)
  if (value !== prevValue) {
    setPrevValue(value);
    setInputValue(value ? `${value.name} (${value.code})` : '');
    setSuggestions([]);
    setIsLoading(false);
  }

  // Debounced station search API call
  useEffect(() => {
    const trimmed = inputValue.trim();

    // Do not search if empty or if input represents an already selected station
    if (!trimmed || (value && inputValue === `${value.name} (${value.code})`)) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setErrorMessage(null);
        const res = await api.get('/stations/search', {
          params: { q: trimmed },
        });
        setSuggestions(res.data.stations || []);
      } catch (err) {
        setErrorMessage(err.response?.data?.error?.message || 'Failed to search stations');
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    // Clean up pending timer if user keeps typing
    return () => clearTimeout(timer);
  }, [inputValue, value]);

  // Close dropdown when user clicks outside the component
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        // If user left without selecting a station, revert display to current value
        if (value) {
          setInputValue(`${value.name} (${value.code})`);
        } else {
          setInputValue('');
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value]);

  const handleInputChange = (e) => {
    const text = e.target.value;
    setInputValue(text);
    setIsOpen(true);

    if (!text.trim()) {
      setSuggestions([]);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    // If an existing station was selected, typing clears the selection
    if (value) {
      onChange(null);
    }
  };

  const handleSelectStation = (station) => {
    onChange(station);
    setInputValue(`${station.name} (${station.code})`);
    setIsOpen(false);
    setSuggestions([]);
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <label className="block text-sm font-semibold text-slate-700 mb-1">
        {label}
      </label>

      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (inputValue.trim().length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
        />

        {/* Loading Spinner */}
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Autocomplete Suggestions Dropdown */}
      {isOpen && inputValue.trim().length > 0 && !value && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {isLoading && suggestions.length === 0 && (
            <div className="px-4 py-3 text-sm text-slate-500 text-center">
              Searching stations...
            </div>
          )}

          {!isLoading && errorMessage && (
            <div className="px-4 py-3 text-sm text-red-600 text-center">
              {errorMessage}
            </div>
          )}

          {!isLoading && !errorMessage && suggestions.length === 0 && (
            <div className="px-4 py-3 text-sm text-slate-500 text-center">
              No matching stations found.
            </div>
          )}

          {!isLoading && suggestions.length > 0 && (
            <ul className="py-1 divide-y divide-slate-100">
              {suggestions.map((station) => (
                <li
                  key={station.id}
                  onClick={() => handleSelectStation(station)}
                  className="px-4 py-2.5 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">
                      {station.name}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                      {station.code}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {station.city}{station.state ? `, ${station.state}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
