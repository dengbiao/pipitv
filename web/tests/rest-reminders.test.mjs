import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dailyRestReminder, restReminderById, restReminderSource } from '../src/rest-reminders.js';

const reminders = JSON.parse(readFileSync(new URL('../../public/rest-reminders.json', import.meta.url)));

test('every daily caption is unique, no more than 15 characters including punctuation, and has bundled audio', () => {
  assert.equal(new Set(reminders.map(reminder => reminder.id)).size, reminders.length);
  assert.equal(new Set(reminders.map(reminder => reminder.text)).size, reminders.length);
  for (const reminder of reminders) {
    assert.ok([...reminder.text].length > 0 && [...reminder.text].length <= 15, reminder.text);
    assert.ok(statSync(new URL(`../../public/${restReminderSource(reminder)}`, import.meta.url)).size > 1000);
    assert.deepEqual(restReminderById(reminder.id), reminder);
  }
  assert.equal(restReminderById('../../other'), null);
});

test('a local day keeps the same reminder, and each following day changes it across months and leap years', () => {
  for (const year of [2026, 2027, 2028]) {
    for (let day = 0; day < 367; day++) {
      const morning = new Date(year, 0, day + 1, 0, 0, 0);
      const evening = new Date(year, 0, day + 1, 23, 59, 59);
      const tomorrow = new Date(year, 0, day + 2, 0, 0, 0);
      assert.deepEqual(dailyRestReminder(morning), dailyRestReminder(evening));
      assert.notEqual(dailyRestReminder(evening).id, dailyRestReminder(tomorrow).id);
    }
  }
});
