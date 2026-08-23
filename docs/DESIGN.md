# SmartRail UI/UX Design System

## 1. UI/UX Principles
- Clean, intuitive, and consistent interface.
- Mobile-first responsive design.
- Clear navigation and information hierarchy.
- Accessible forms, buttons, and status indicators.
- Reusable components and consistent spacing.
- Booking information, PNR, seat, class, and journey details must be easy to find.
- Avoid unnecessary visual complexity.

### Railway-specific UX
- Clearly show train, route, date, class, and availability.
- Distinguish Available, RAC, and Waitlist states.
- Show berth/window preferences before confirmation.
- Clearly explain smart seat allocation results.
- Never present a preference as a guaranteed seat.

## 2. Color & Theme

### Brand
- Primary: `#2563EB`
- Primary Dark: `#1D4ED8`
- Secondary/Success: `#16A34A`
- Accent: `#F59E0B`

### Surfaces
- Background: `#F8FAFC`
- Card: `#FFFFFF`
- Muted: `#F1F5F9`

### Text
- Primary: `#0F172A`
- Secondary: `#475569`
- Muted: `#64748B`

### Status
- Confirmed/Success: Green
- RAC/Warning: Amber
- Failed/Error: Red
- Information: Blue
- Waitlist/Neutral: Gray

Dark mode is optional for V1.

## 3. Fonts & Typography
Use a clean sans-serif font such as Inter with system fallbacks.

- H1: Page title
- H2: Major section
- H3: Card/feature title
- Body: Main content
- Small text: Metadata and timestamps

Use highly readable typography for PNR, seat numbers, prices, train numbers, and times.

## 4. Reusable Components
- Navbar
- Sidebar
- Buttons
- Inputs/selects
- Search form
- Train cards
- Coach/seat cards
- Passenger cards
- Booking summary
- Status badges
- Modals
- Alerts/toasts
- Tables
- Loading and empty states
- Notifications

## 5. Booking UX

```text
Search Train
    ↓
Select Train
    ↓
Choose Class
    ↓
Add Passengers
    ↓
Set Preferences
    ↓
Review Smart Allocation
    ↓
Mock Payment
    ↓
PNR Confirmation
```

Always show current step, journey details, passengers, amount, seat allocation, and booking status.

## 6. Smart Seat Allocation UI
Explain results in simple language.

Examples:
- "Seats were allocated close together for all passengers."
- "Lower berth preference could not be fully satisfied because of availability."

Do not expose technical scoring to normal users. An optional "Why this seat?" detail can explain the main allocation reason.

## 7. Seat Visualization
Use consistent visual states:
- Available
- Selected
- Occupied
- Reserved
- RAC
- Unavailable

Do not rely on color alone; include labels/icons where useful.

## 8. Accessibility
- Semantic HTML
- Proper form labels
- Keyboard navigation
- Visible focus states
- Accessible error messages
- Adequate contrast
- Clear action labels

## 9. Responsive Design
Design mobile-first for mobile, tablet, and desktop. Important booking information must not require horizontal scrolling.

## 10. Consistency Rules
- Reuse existing components.
- Avoid one-off styling when a reusable pattern exists.
- Keep spacing, radius, shadows, and typography consistent.
- Avoid excessive animation.
