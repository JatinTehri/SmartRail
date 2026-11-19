/**
 * trains.js — Demonstration Trains & Ordered Schedules
 *
 * Trains are strictly non-midnight-crossing (all stops between 06:00 and 22:30).
 * Clearly labelled demo train numbers: DEMO-EXP-01 and DEMO-SF-02.
 */

'use strict';

module.exports = [
  {
    train_number: 'DEMO-EXP-01',
    train_name: 'SmartRail Express',
    train_type: 'EXPRESS',
    active: true,
    stops: [
      {
        station_code: 'NDLS',
        stop_order: 1,
        arrival_time: null,
        departure_time: '06:00',
        distance_km: 0.00
      },
      {
        station_code: 'CNB',
        stop_order: 2,
        arrival_time: '10:30',
        departure_time: '10:40',
        distance_km: 440.00
      },
      {
        station_code: 'PRYJ',
        stop_order: 3,
        arrival_time: '12:45',
        departure_time: '12:55',
        distance_km: 635.00
      },
      {
        station_code: 'DDU',
        stop_order: 4,
        arrival_time: '15:00',
        departure_time: '15:15',
        distance_km: 786.00
      },
      {
        station_code: 'HWH',
        stop_order: 5,
        arrival_time: '22:30',
        departure_time: null,
        distance_km: 1447.00
      }
    ],
    coaches: [
      {
        coach_number: 'B1',
        coach_type: 'AC_3_TIER',
        class_code: '3A',
        seat_capacity: 72
      },
      {
        coach_number: 'A1',
        coach_type: 'AC_2_TIER',
        class_code: '2A',
        seat_capacity: 52
      }
    ]
  },
  {
    train_number: 'DEMO-SF-02',
    train_name: 'SmartRail Superfast',
    train_type: 'SUPERFAST',
    active: true,
    stops: [
      {
        station_code: 'NDLS',
        stop_order: 1,
        arrival_time: null,
        departure_time: '07:30',
        distance_km: 0.00
      },
      {
        station_code: 'CNB',
        stop_order: 2,
        arrival_time: '12:00',
        departure_time: '12:10',
        distance_km: 440.00
      },
      {
        station_code: 'PRYJ',
        stop_order: 3,
        arrival_time: '14:15',
        departure_time: '14:25',
        distance_km: 635.00
      },
      {
        station_code: 'DDU',
        stop_order: 4,
        arrival_time: '16:45',
        departure_time: null,
        distance_km: 786.00
      }
    ],
    coaches: [
      {
        coach_number: 'S1',
        coach_type: 'SLEEPER',
        class_code: 'SL',
        seat_capacity: 80
      },
      {
        coach_number: 'B1',
        coach_type: 'AC_3_TIER',
        class_code: '3A',
        seat_capacity: 72
      }
    ]
  }
];
