// bus.js — tiny shared context so views can trigger a rerender without
// importing app.js (avoids circular imports).
export const bus = {
  todayIso: null,          // logical today, set by app.js each render
  viewDate: null,          // the date Tonight is showing (swipe-back)
  events: [],              // engine event cards, shown until navigation
  rerender: () => {},      // set by app.js
  navigate: () => {},      // set by app.js
};
