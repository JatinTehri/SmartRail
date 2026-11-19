import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import StationSelect from '../components/StationSelect';
import TrainCard from '../components/TrainCard';

/**
 * Returns today's date formatted as YYYY-MM-DD in Asia/Kolkata timezone.
 */
function getTodayIST() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year').value;
  const month = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

/**
 * Returns tomorrow's date formatted as YYYY-MM-DD in Asia/Kolkata timezone.
 */
function getTomorrowIST() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(tomorrow);

  const year = parts.find((p) => p.type === 'year').value;
  const month = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

const ALLOWED_CLASSES = [
  { code: '', label: 'All Classes' },
  { code: '1A', label: 'AC First Class (1A)' },
  { code: '2A', label: 'AC 2 Tier (2A)' },
  { code: '3A', label: 'AC 3 Tier (3A)' },
  { code: 'SL', label: 'Sleeper (SL)' },
  { code: 'CC', label: 'AC Chair Car (CC)' },
  { code: '2S', label: 'Second Sitting (2S)' },
  { code: 'EC', label: 'Executive Chair Car (EC)' },
];

export default function TrainSearch() {
  const [searchParams, setSearchParams] = useSearchParams();

  const minDate = getTodayIST();
  const defaultDate = getTomorrowIST();

  const fromId = searchParams.get('fromStationId');
  const toId = searchParams.get('toStationId');
  const journeyDateParam = searchParams.get('journeyDate');
  const classCodeParam = searchParams.get('classCode');
  const hasSearchParams = Boolean(fromId && toId && journeyDateParam);

  const [fromStation, setFromStation] = useState(null);
  const [toStation, setToStation] = useState(null);
  const [journeyDate, setJourneyDate] = useState(journeyDateParam || defaultDate);
  const [classCode, setClassCode] = useState(classCodeParam || '');
  const [validationError, setValidationError] = useState(null);

  // Train search results state (initializes to loading if URL already contains valid search params)
  const [trains, setTrains] = useState(null);
  const [isLoading, setIsLoading] = useState(hasSearchParams);
  const [apiError, setApiError] = useState(null);

  // Synchronize and fetch results whenever valid URL search parameters are present
  useEffect(() => {
    if (!hasSearchParams) {
      return;
    }

    let isCancelled = false;

    api
      .get('/trains/search', {
        params: {
          fromStationId: fromId,
          toStationId: toId,
          journeyDate: journeyDateParam,
          classCode: classCodeParam || undefined,
        },
      })
      .then((res) => {
        if (!isCancelled) {
          setTrains(res.data.trains || []);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setApiError(err.response?.data?.error?.message || 'Failed to search trains. Please try again.');
          setTrains([]);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    // Cleanup: Discard outdated in-flight requests if user triggers a new search
    return () => {
      isCancelled = true;
    };
  }, [fromId, toId, journeyDateParam, classCodeParam, hasSearchParams]);

  // Swap source and destination stations
  const handleSwapStations = () => {
    const temp = fromStation;
    setFromStation(toStation);
    setToStation(temp);
    setValidationError(null);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setValidationError(null);

    // 1. Validate source station
    if (!fromStation) {
      setValidationError('Please select a valid source station from the suggestions.');
      return;
    }

    // 2. Validate destination station
    if (!toStation) {
      setValidationError('Please select a valid destination station from the suggestions.');
      return;
    }

    // 3. Ensure source and destination are different
    if (fromStation.id === toStation.id) {
      setValidationError('Source and destination stations cannot be identical.');
      return;
    }

    // 4. Validate journey date
    if (!journeyDate) {
      setValidationError('Please select a valid journey date.');
      return;
    }

    if (journeyDate < minDate) {
      setValidationError('Journey date cannot be in the past.');
      return;
    }

    // Update URL query parameters (this triggers the useEffect fetcher)
    const newParams = {
      fromStationId: fromStation.id,
      toStationId: toStation.id,
      journeyDate,
    };
    if (classCode) {
      newParams.classCode = classCode;
    }

    setIsLoading(true);
    setApiError(null);
    setSearchParams(newParams);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
          Search <span className="text-blue-600">Trains</span>
        </h1>
        <p className="mt-2 text-slate-600 text-sm sm:text-base">
          Find available trains between Indian railway stations with real-time seat availability.
        </p>
      </div>

      {/* Search Form Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8 mb-8">
        <form onSubmit={handleSearchSubmit} className="space-y-6">
          {/* Station Inputs Row */}
          <div className="grid grid-cols-1 md:grid-cols-11 gap-4 items-end">
            <div className="md:col-span-5">
              <StationSelect
                label="From (Source)"
                value={fromStation}
                onChange={setFromStation}
                placeholder="e.g. New Delhi or NDLS"
              />
            </div>

            {/* Swap Button */}
            <div className="md:col-span-1 flex justify-center pb-1">
              <button
                type="button"
                onClick={handleSwapStations}
                title="Swap source and destination stations"
                className="p-2.5 rounded-full border border-slate-300 text-slate-600 hover:text-blue-600 hover:border-blue-500 hover:bg-blue-50 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                  />
                </svg>
              </button>
            </div>

            <div className="md:col-span-5">
              <StationSelect
                label="To (Destination)"
                value={toStation}
                onChange={setToStation}
                placeholder="e.g. Kanpur Central or CNB"
              />
            </div>
          </div>

          {/* Date and Class Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Journey Date */}
            <div>
              <label htmlFor="journey-date" className="block text-sm font-semibold text-slate-700 mb-1">
                Journey Date
              </label>
              <input
                id="journey-date"
                type="date"
                min={minDate}
                value={journeyDate}
                onChange={(e) => {
                  setJourneyDate(e.target.value);
                  setValidationError(null);
                }}
                className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Class Filter */}
            <div>
              <label htmlFor="class-code" className="block text-sm font-semibold text-slate-700 mb-1">
                Travel Class (Optional)
              </label>
              <select
                id="class-code"
                value={classCode}
                onChange={(e) => setClassCode(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              >
                {ALLOWED_CLASSES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Validation Error Message */}
          {validationError && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>{validationError}</span>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              className="w-full sm:w-auto px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition-colors duration-150 flex items-center justify-center gap-2 cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search Trains
            </button>
          </div>
        </form>
      </div>

      {/* Results Section */}
      {hasSearchParams && (
        <div className="space-y-4">
          {/* Loading Indicator */}
          {isLoading && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-slate-600 font-medium text-sm">Searching for available trains...</p>
            </div>
          )}

          {/* API Error State */}
          {!isLoading && apiError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-700 text-sm flex items-start gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <strong className="font-semibold block mb-0.5">Search Failed</strong>
                <span>{apiError}</span>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !apiError && trains !== null && trains.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
              <div className="text-4xl mb-3">🚆</div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">No Trains Found</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                No direct trains operate between the selected stations on this journey date. Try searching for a different date or alternative route stations.
              </p>
            </div>
          )}

          {/* Results List */}
          {!isLoading && !apiError && trains !== null && trains.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xl font-bold text-slate-900">
                  Available Trains ({trains.length})
                </h2>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-600">
                  Date: {journeyDateParam}
                </span>
              </div>

              <div className="space-y-4">
                {trains.map((train) => (
                  <TrainCard
                    key={train.id}
                    train={train}
                    searchContext={{
                      fromStationId: fromId,
                      toStationId: toId,
                      journeyDate: journeyDateParam,
                      classCode: classCodeParam,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
