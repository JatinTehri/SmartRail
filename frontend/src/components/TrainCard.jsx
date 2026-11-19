import { Link } from 'react-router-dom';

/**
 * TrainCard.jsx — Displays summary information for a single train result.
 *
 * Renders the exact attributes returned by GET /api/trains/search:
 *   - trainNumber, trainName, trainType
 *   - departure, arrival, duration, distanceKm
 *   - classes (available coach classes)
 *   - View Availability action link (navigates to Stage 3.6 availability page)
 *
 * Styled using Tailwind CSS and design tokens from docs/DESIGN.md.
 */

export default function TrainCard({ train, searchContext }) {
  if (!train) return null;

  const hasSearchContext =
    searchContext?.fromStationId &&
    searchContext?.toStationId &&
    searchContext?.journeyDate;

  const availabilityUrl = hasSearchContext
    ? `/trains/${train.id}/availability?fromStationId=${searchContext.fromStationId}&toStationId=${searchContext.toStationId}&journeyDate=${searchContext.journeyDate}${
        searchContext.classCode ? `&classCode=${searchContext.classCode}` : ''
      }`
    : null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Top Header: Train Name, Number & Type */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg text-slate-900 tracking-tight">
              {train.trainName}
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
              {train.trainNumber}
            </span>
          </div>
          {train.trainType && (
            <span className="text-xs text-slate-500 font-medium">
              {train.trainType}
            </span>
          )}
        </div>

        {/* Distance Badge */}
        {train.distanceKm !== undefined && (
          <div className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
            {train.distanceKm} km
          </div>
        )}
      </div>

      {/* Middle Section: Schedule, Journey Duration & Times */}
      <div className="grid grid-cols-3 items-center py-4 text-center">
        {/* Departure */}
        <div className="text-left">
          <div className="text-2xl font-bold text-slate-900">
            {train.departure || '--:--'}
          </div>
          <div className="text-xs text-slate-500 font-medium mt-0.5">
            Departure
          </div>
        </div>

        {/* Duration Visual */}
        <div className="flex flex-col items-center">
          <span className="text-xs font-semibold text-slate-600 mb-1">
            {train.duration || '--'}
          </span>
          <div className="w-full flex items-center gap-1">
            <div className="h-0.5 flex-1 bg-slate-200" />
            <span className="text-slate-400 text-xs">&#9654;</span>
          </div>
        </div>

        {/* Arrival */}
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900">
            {train.arrival || '--:--'}
          </div>
          <div className="text-xs text-slate-500 font-medium mt-0.5">
            Arrival
          </div>
        </div>
      </div>

      {/* Bottom Section: Available Coach Classes & View Availability Link */}
      <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
        {train.classes && train.classes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 mr-1">
              Classes:
            </span>
            {train.classes.map((cls) => (
              <span
                key={cls}
                className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200"
              >
                {cls}
              </span>
            ))}
          </div>
        )}

        {/* Action Button to View Availability */}
        {availabilityUrl && (
          <Link
            to={availabilityUrl}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <span>View Availability</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
      </div>
    </div>
  );
}
