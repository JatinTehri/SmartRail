/**
 * foodMenu.js — Demonstration Station-Specific Catering Items
 *
 * 11 food menu items spread across NDLS, CNB, PRYJ, and HWH stations.
 */

'use strict';

module.exports = [
  // New Delhi (NDLS)
  {
    station_code: 'NDLS',
    name: 'Executive Veg Thali',
    description: 'Complete North Indian meal with paneer, dal, rice, roti and sweet',
    price: 180.00,
    active: true
  },
  {
    station_code: 'NDLS',
    name: 'Chole Bhature',
    description: 'Two fluffy bhature served with spiced Punjabi chole',
    price: 95.00,
    active: true
  },
  {
    station_code: 'NDLS',
    name: 'Masala Chai',
    description: 'Freshly brewed spiced tea with ginger and cardamom',
    price: 20.00,
    active: true
  },

  // Kanpur Central (CNB)
  {
    station_code: 'CNB',
    name: 'Standard Veg Meal',
    description: 'Thali with seasonal vegetables, dal, rice and parathas',
    price: 120.00,
    active: true
  },
  {
    station_code: 'CNB',
    name: 'Paneer Kulcha Plate',
    description: 'Two stuffed paneer kulchas served with chole',
    price: 85.00,
    active: true
  },
  {
    station_code: 'CNB',
    name: 'Filter Coffee',
    description: 'Hot traditional South Indian filter coffee',
    price: 25.00,
    active: true
  },

  // Prayagraj Junction (PRYJ)
  {
    station_code: 'PRYJ',
    name: 'Puri Sabzi Plate',
    description: 'Four crispy puris served with spiced potato curry',
    price: 70.00,
    active: true
  },
  {
    station_code: 'PRYJ',
    name: 'Sweet Lassi',
    description: 'Traditional thick chilled yogurt drink in earthen kulhad',
    price: 45.00,
    active: true
  },

  // Howrah Junction (HWH)
  {
    station_code: 'HWH',
    name: 'Bengali Fish Curry Rice',
    description: 'Fresh Rohu fish curry served with steamed basmati rice',
    price: 175.00,
    active: true
  },
  {
    station_code: 'HWH',
    name: 'Mishti Doi Cup',
    description: 'Traditional sweetened fermented yogurt dessert',
    price: 40.00,
    active: true
  },
  {
    station_code: 'HWH',
    name: 'Sandesh Sweet Box',
    description: 'Assorted artisanal Bengali cottage cheese sweets',
    price: 120.00,
    active: true
  }
];
