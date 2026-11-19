import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import api from '../services/api';
import SeatLayout from '../components/SeatLayout';

/**
 * SeatAvailability.jsx — Coach and Seat Availability Explorer.
 *
 * Displays:
 *   - Train and journey segment summary (source, destination, date)
 *   - Overall confirmed and RAC availability quotas
 *   - Coach selector tabs (showing class, type, capacity, and quotas)
 *   - Active coach summary card
 *
 * Strictly read-only: does not perform booking, holds, or passenger mutations.
 */
export default function SeatAvailability() {
  const { trainId } = useParams();
  const [searchParams] = useSearchParams();

  const fromStationId = searchParams.get('fromStationId');
  const toStationId = searchParams.get('toStationId');
  const journeyDate = searchParams.get('journeyDate');
  const classCode = searchParams.get('classCode');

  const hasRequiredParams = Boolean(trainId && fromStationId && toStationId && journeyDate);

  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(hasRequiredParams);
  const [apiError, setApiError] = useState(null);
  const [selectedCoachId, setSelectedCoachId] = useState(null);

  useEffect(() => {
    if (!hasRequiredParams) {
      return;
    }

    let isCancelled = false;

    api
      .get(`/trains/${trainId}/availability`, {
        params: {
          fromStationId,
          toStationId,
          journeyDate,
          classCode: classCode || undefined,
        },
      })
      .then((res) => {
        if (!isCancelled) {
          setData(res.data);
          // Default selection to first coach ID
          if (res.data.coaches && res.data.coaches.length > 0) {
            setSelectedCoachId(res.data.coaches[0].coachId);
          }
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setApiError(
            err.response?.data?.error?.message ||
              'Failed to retrieve seat availability. Please try again.'
          );
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [trainId, fromStationId, toStationId, journeyDate, classCode, hasRequiredParams]);

  // Back to search URL preserving user search coordinates
  const searchBackUrl = hasRequiredParams
    ? `/search?fromStationId=${fromStationId}&toStationId=${toStationId}&journeyDate=${journeyDate}${
        classCode ? `&classCode=${classCode}` : ''
      }`
    : '/search';

  // Derived active coach
  const activeCoach =
    data?.coaches?.find((c) => c.coachId === selectedCoachId) ||
    data?.coaches?.[0] ||
    null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      {/* Navigation Breadcrumb */}
      <div className="mb-6">
        <Link
          to={searchBackUrl}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span>Back to Search Results</span>
        </Link>
      </div>

      {/* Incomplete URL Parameters Guard */}
      {!hasRequiredParams && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center text-amber-800">
          <h2 className="text-lg font-bold mb-2">Missing Journey Information</h2>
          <p className="text-sm mb-4">
            Seat availability requires origin station, destination station, and journey date.
          </p>
          <Link
            to="/search"
            className="inline-block px-5 py-2.5 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go to Train Search
          </Link>
        </div>
      )}

      {/* Loading State */}
      {hasRequiredParams && isLoading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-600 font-medium text-sm">
            Fetching coach and seat availability...
          </p>
        </div>
      )}

      {/* API Error State */}
      {hasRequiredParams && !isLoading && apiError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
          <div className="flex items-start gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-6 h-6 flex-shrink-0 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <h3 className="font-bold text-base mb-1">Availability Lookup Failed</h3>
              <p className="text-sm">{apiError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Content State: Loaded Availability Details */}
      {hasRequiredParams && !isLoading && !apiError && data && (
        <div className="space-y-6">
          {/* Header Card: Train & Segment Info */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                    {data.trainName}
                  </h1>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded bg-blue-100 text-blue-800">
                    {data.trainNumber}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium mt-1">
                  Journey Date: <strong className="text-slate-800">{data.journeyDate}</strong>
                </p>
              </div>

              {/* Station Route Badge */}
              <div className="bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl text-sm">
                <span className="font-bold text-slate-900">{data.fromStation.name}</span>
                <span className="text-slate-400 font-semibold mx-1">({data.fromStation.code})</span>
                <span className="text-slate-400 mx-2">&rarr;</span>
                <span className="font-bold text-slate-900">{data.toStation.name}</span>
                <span className="text-slate-400 font-semibold mx-1">({data.toStation.code})</span>
              </div>
            </div>

            {/* Overall Availability Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              {/* Confirmed Availability */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <div className="text-xs font-bold text-emerald-800 uppercase tracking-wide">
                  Confirmed Berths Available
                </div>
                <div className="text-3xl font-extrabold text-emerald-700 mt-1">
                  {data.availability?.confirmed ?? 0}
                </div>
                <p className="text-xs text-emerald-700 mt-1">
                  Full sleeping berths available for immediate reservation.
                </p>
              </div>

              {/* RAC Availability */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="text-xs font-bold text-amber-800 uppercase tracking-wide">
                  RAC Seats Available
                </div>
                <div className="text-3xl font-extrabold text-amber-700 mt-1">
                  {data.availability?.rac ?? 0}
                </div>
                <p className="text-xs text-amber-700 mt-1">
                  Sitting accommodation during day; alternative booking quota.
                </p>
              </div>
            </div>
          </div>

          {/* Coach Selection & Layout Section */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-4">
              Select Coach
            </h2>

            {/* Coach Tabs */}
            {data.coaches && data.coaches.length > 0 ? (
              <div>
                <div className="flex flex-wrap gap-2.5 pb-4 border-b border-slate-100">
                  {data.coaches.map((coach) => {
                    const isSelected = activeCoach?.coachId === coach.coachId;
                    return (
                      <button
                        key={coach.coachId}
                        type="button"
                        onClick={() => setSelectedCoachId(coach.coachId)}
                        className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-600 ring-offset-2'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                        }`}
                      >
                        <span>Coach {coach.coachNumber}</span>
                        <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${
                          isSelected ? 'bg-blue-700 text-blue-100' : 'bg-white text-slate-600'
                        }`}>
                          {coach.classCode}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Active Coach Details */}
                {activeCoach && (
                  <div className="mt-6">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <div className="font-bold text-slate-900 text-base">
                            Coach {activeCoach.coachNumber} ({activeCoach.coachType})
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Class: <strong className="text-slate-700">{activeCoach.classCode}</strong> | Total Capacity: <strong className="text-slate-700">{activeCoach.seatCapacity} Berths</strong>
                          </div>
                        </div>

                        {/* Quotas on this coach */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200">
                            Confirmed: {activeCoach.availableConfirmed}
                          </span>
                          <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 border border-amber-200">
                            RAC: {activeCoach.availableRac}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Physical Seat Layout Grid */}
                    <SeatLayout
                      seats={activeCoach.seats}
                      coachNumber={activeCoach.coachNumber}
                      classCode={activeCoach.classCode}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-slate-500 text-center py-6">
                No coaches configured for this train.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
