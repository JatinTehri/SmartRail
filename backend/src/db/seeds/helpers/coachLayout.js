/**
 * coachLayout.js — SmartRail Coach & Berth Layout Generator
 *
 * Implements the SmartRail demonstration coach configurations:
 *   - Sleeper (SL): 80 berths (10 bays x 8 berths)
 *   - AC 3-Tier (3A): 72 berths (9 bays x 8 berths)
 *   - AC 2-Tier (2A): 52 berths (8 bays x 6 berths + 1 partial bay of 4 berths)
 *
 * SmartRail Demonstration Assumptions:
 *   - Window rule: All SIDE_LOWER berths are window seats (Rule 1).
 *     In each main compartment bay, lower berth 1 (against the outer wall) is a window seat (Rule 2).
 *   - RAC Quotas:
 *     - SL: Exactly 4 berths (Seats 7, 15, 23, 31)
 *     - 3A: Exactly 2 berths (Seats 7, 15)
 *     - 2A: Exactly 1 berth (Seat 5)
 */

'use strict';

/**
 * Generate seats array for a coach.
 *
 * @param {string} coachType - e.g. 'SLEEPER', 'AC_3_TIER', 'AC_2_TIER'
 * @param {string} classCode - e.g. 'SL', '3A', '2A'
 * @param {number} seatCapacity - 80, 72, or 52
 * @returns {Array<{seat_number: string, berth_type: string, position: string, is_window: boolean, rac_capable: boolean}>}
 */
function generateLhbSeats(coachType, classCode, seatCapacity) {
  const seats = [];

  if (classCode === 'SL' && seatCapacity === 80) {
    const totalBays = 10;
    const racBerths = [7, 15, 23, 31];

    for (let bay = 1; bay <= totalBays; bay++) {
      const bayStart = (bay - 1) * 8;

      seats.push({
        seat_number: String(bayStart + 1),
        berth_type: 'LOWER',
        position: 'MAIN',
        is_window: true,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 2),
        berth_type: 'MIDDLE',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 3),
        berth_type: 'UPPER',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 4),
        berth_type: 'LOWER',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 5),
        berth_type: 'MIDDLE',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 6),
        berth_type: 'UPPER',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });

      const sideLowerNum = bayStart + 7;
      seats.push({
        seat_number: String(sideLowerNum),
        berth_type: 'SIDE_LOWER',
        position: 'SIDE',
        is_window: true,
        rac_capable: racBerths.includes(sideLowerNum)
      });

      seats.push({
        seat_number: String(bayStart + 8),
        berth_type: 'SIDE_UPPER',
        position: 'SIDE',
        is_window: false,
        rac_capable: false
      });
    }

    return seats;
  }

  if (classCode === '3A' && seatCapacity === 72) {
    const totalBays = 9;
    const racBerths = [7, 15];

    for (let bay = 1; bay <= totalBays; bay++) {
      const bayStart = (bay - 1) * 8;

      seats.push({
        seat_number: String(bayStart + 1),
        berth_type: 'LOWER',
        position: 'MAIN',
        is_window: true,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 2),
        berth_type: 'MIDDLE',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 3),
        berth_type: 'UPPER',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 4),
        berth_type: 'LOWER',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 5),
        berth_type: 'MIDDLE',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 6),
        berth_type: 'UPPER',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });

      const sideLowerNum = bayStart + 7;
      seats.push({
        seat_number: String(sideLowerNum),
        berth_type: 'SIDE_LOWER',
        position: 'SIDE',
        is_window: true,
        rac_capable: racBerths.includes(sideLowerNum)
      });

      seats.push({
        seat_number: String(bayStart + 8),
        berth_type: 'SIDE_UPPER',
        position: 'SIDE',
        is_window: false,
        rac_capable: false
      });
    }

    return seats;
  }

  if (classCode === '2A' && seatCapacity === 52) {
    // 8 full bays (6 berths each) = 48 berths
    for (let bay = 1; bay <= 8; bay++) {
      const bayStart = (bay - 1) * 6;

      seats.push({
        seat_number: String(bayStart + 1),
        berth_type: 'LOWER',
        position: 'MAIN',
        is_window: true,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 2),
        berth_type: 'UPPER',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 3),
        berth_type: 'LOWER',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });
      seats.push({
        seat_number: String(bayStart + 4),
        berth_type: 'UPPER',
        position: 'MAIN',
        is_window: false,
        rac_capable: false
      });

      const sideLowerNum = bayStart + 5;
      seats.push({
        seat_number: String(sideLowerNum),
        berth_type: 'SIDE_LOWER',
        position: 'SIDE',
        is_window: true,
        rac_capable: sideLowerNum === 5 // Only seat 5 is RAC
      });

      seats.push({
        seat_number: String(bayStart + 6),
        berth_type: 'SIDE_UPPER',
        position: 'SIDE',
        is_window: false,
        rac_capable: false
      });
    }

    // Partial End Bay 9 (4 berths: 49, 50, 51, 52)
    seats.push({
      seat_number: '49',
      berth_type: 'LOWER',
      position: 'MAIN',
      is_window: true,
      rac_capable: false
    });
    seats.push({
      seat_number: '50',
      berth_type: 'UPPER',
      position: 'MAIN',
      is_window: false,
      rac_capable: false
    });
    seats.push({
      seat_number: '51',
      berth_type: 'LOWER',
      position: 'MAIN',
      is_window: false,
      rac_capable: false
    });
    seats.push({
      seat_number: '52',
      berth_type: 'UPPER',
      position: 'MAIN',
      is_window: false,
      rac_capable: false
    });

    return seats;
  }

  throw new Error(`Unsupported coach configuration: ${classCode} (${coachType}) with capacity ${seatCapacity}`);
}

module.exports = {
  generateLhbSeats
};
