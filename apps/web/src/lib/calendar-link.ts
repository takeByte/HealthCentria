/**
 * "Add to my Google Calendar" link for a patient's own visit. Opens Google's
 * pre-filled event form in the patient's personal account. No API keys, and
 * nothing is shared with the clinic's calendar. The visit is an all-day event
 * because bookings are per day (with a morning/afternoon preference), not per slot.
 */

const TIME_LABEL = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  any: 'Any time',
} as const;

function compact(ymd: string): string {
  return ymd.replace(/-/g, '');
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const n = new Date(y, m - 1, d + 1);
  return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
}

export function googleCalendarAddUrl(input: {
  serviceName: string;
  day: string; // YYYY-MM-DD
  timePreference: keyof typeof TIME_LABEL;
}): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${input.serviceName} visit (HealthCentria)`,
    dates: `${compact(input.day)}/${nextDay(input.day)}`,
    details: [
      `Confirmed ${input.serviceName} appointment at the health center.`,
      `Preferred time: ${TIME_LABEL[input.timePreference]}.`,
      'Manage or cancel it in HealthCentria under My Appointments.',
    ].join('\n'),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
