/**
 * SeatLayout.jsx — Visual seat layout grid for a train coach.
 *
 * Renders physical seats divided into MAIN (cabin) and SIDE (corridor) berths.
 * Displays:
 *   - Seat number and human-readable berth type (Lower, Middle, Upper, Side Lower, Side Upper)
 *   - Window indicator (🪟 Window)
 *   - Confirmed availability (Green) vs Occupied/Held (Gray)
 *   - RAC slot availability (Amber): Slot 1 & 2, Slot 1, Slot 2, or Full
 *
 * Strictly read-only: displays backend availability state without client-side recalculation.
 */

function formatBerthType(type) {
  switch (type) {
    case 'LOWER':
      return 'Lower';
    case 'MIDDLE':
      return 'Middle';
    case 'UPPER':
      return 'Upper';
    case 'SIDE_LOWER':
      return 'Side Lower';
    case 'SIDE_UPPER':
      return 'Side Upper';
    default:
      return type;
  }
}

export default function SeatLayout({ seats = [], coachNumber, classCode }) {
  if (!seats || seats.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-sm">
        No seat data available for Coach {coachNumber}.
      </div>
    );
  }

  // Sort seats by numeric seatNumber for consistent display
  const sortedSeats = [...seats].sort(
    (a, b) => Number(a.seatNumber) - Number(b.seatNumber)
  );

  const mainSeats = sortedSeats.filter((s) => s.position === 'MAIN');
  const sideSeats = sortedSeats.filter((s) => s.position === 'SIDE');

  const renderSeatCard = (seat) => {
    // 1. RAC-capable Berth Styling & Labeling
    if (seat.racCapable) {
      const slots = seat.racSlotsAvailable || [];
      const hasBoth = slots.includes(1) && slots.includes(2);
      const hasSlot1Only = slots.includes(1) && !slots.includes(2);
      const hasSlot2Only = !slots.includes(1) && slots.includes(2);

      let racLabel = 'RAC Full';
      let racColor = 'bg-slate-100 border-slate-200 text-slate-500';

      if (hasBoth) {
        racLabel = 'RAC Slots 1 & 2';
        racColor = 'bg-amber-50 border-amber-300 text-amber-900';
      } else if (hasSlot1Only) {
        racLabel = 'RAC Slot 1 (Slot 2 Booked)';
        racColor = 'bg-amber-50 border-amber-300 text-amber-900';
      } else if (hasSlot2Only) {
        racLabel = 'RAC Slot 2 (Slot 1 Booked)';
        racColor = 'bg-amber-50 border-amber-300 text-amber-900';
      }

      return (
        <div
          key={seat.seatId}
          className={`border rounded-xl p-3 flex flex-col justify-between transition-colors ${racColor}`}
        >
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="font-bold text-base">#{seat.seatNumber}</span>
            {seat.isWindow && <span title="Window Seat" className="text-xs">🪟</span>}
          </div>

          <div className="text-xs font-medium opacity-80 mb-2">
            {formatBerthType(seat.berthType)}
          </div>

          <div className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white/80 border border-current text-center">
            {racLabel}
          </div>
        </div>
      );
    }

    // 2. Normal Berth Styling (Confirmed Available vs Occupied)
    const isAvail = seat.isAvailable;
    const cardColor = isAvail
      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
      : 'bg-slate-50 border-slate-200 text-slate-400';

    const statusBadge = isAvail
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : 'bg-slate-200 text-slate-500 border-slate-300';

    return (
      <div
        key={seat.seatId}
        className={`border rounded-xl p-3 flex flex-col justify-between transition-colors ${cardColor}`}
      >
        <div className="flex items-center justify-between gap-1 mb-1">
          <span className="font-bold text-base">#{seat.seatNumber}</span>
          {seat.isWindow && <span title="Window Seat" className="text-xs">🪟</span>}
        </div>

        <div className="text-xs font-medium opacity-80 mb-2">
          {formatBerthType(seat.berthType)}
        </div>

        <div className={`text-[11px] font-semibold px-2 py-0.5 rounded border text-center ${statusBadge}`}>
          {isAvail ? 'Available' : 'Occupied'}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Visual Status Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600 p-3 bg-slate-50 border border-slate-200 rounded-xl">
        <span className="font-semibold text-slate-700">Legend:</span>
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded bg-emerald-100 border border-emerald-400 inline-block" />
          <span>Confirmed Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded bg-amber-100 border border-amber-400 inline-block" />
          <span>RAC Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded bg-slate-100 border border-slate-300 inline-block" />
          <span>Occupied / Full</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>🪟</span>
          <span>Window Berth</span>
        </div>
      </div>

      {/* Main Cabin Berths Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
            Main Cabin Berths ({mainSeats.length})
          </h3>
          <span className="text-xs text-slate-500">
            {classCode === '2A' ? 'Lower & Upper' : 'Lower, Middle & Upper'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {mainSeats.map(renderSeatCard)}
        </div>
      </div>

      {/* Corridor / Aisle Walkway Visual Divider */}
      <div className="relative py-2">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t-2 border-dashed border-slate-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Aisle / Corridor Walkway
          </span>
        </div>
      </div>

      {/* Side Berths Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
            Side Berths ({sideSeats.length})
          </h3>
          <span className="text-xs text-slate-500">
            Side Lower & Side Upper (RAC Quota)
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-3">
          {sideSeats.map(renderSeatCard)}
        </div>
      </div>
    </div>
  );
}
