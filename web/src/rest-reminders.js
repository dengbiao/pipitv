import reminders from '../../public/rest-reminders.json' with { type: 'json' };

// Local calendar dates keep a day's caption and recording stable across restarts,
// month boundaries and daylight-saving changes. No network or TTS engine is needed.
export function dailyRestReminder(now = Date.now()) {
  const date = new Date(now);
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const epoch = Date.UTC(2026, 10, 1) / 86400000;
  return reminders[((day - epoch) % reminders.length + reminders.length) % reminders.length];
}

export function restReminderById(id) {
  return reminders.find(reminder => reminder.id === id) || null;
}

export const restReminderSource = reminder => `rest-audio/${reminder.id}.m4a`;
