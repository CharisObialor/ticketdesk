export const TOUR_START_EVENT = 'tour:start';

// Opens the tour again from anywhere (the user menu uses this). Kept apart from the tour itself, which loads later.
export const startTour = () => window.dispatchEvent(new Event(TOUR_START_EVENT));
