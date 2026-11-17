// Profile archive check, shared by the side panel (file import, editor save) and the background (archive sent by the
// JobSeeker web app). Moved out of panel.js unchanged in 0.8.0.
import { schema } from './matching.js';

export function validateArchive(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Not a valid archive.');
  const result = { profile: {}, education: [], experience: [], activity: [], award: [] };
  for (const [group, keys] of Object.entries(schema)) {
    const records = group === 'profile' ? [data.profile || {}] : data[group] || [];
    if (!Array.isArray(records) || records.length > 100) throw Error('Check the record list format.');
    const clean = records.map(record => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw Error('Check the record format.');
      const item = {};
      for (const key of Object.keys(keys)) { const value = record[key] ?? ''; if (typeof value !== 'string' || value.length > 20000) throw Error('Each value must be text under 20,000 characters.'); item[key] = value; }
      return item;
    });
    result[group] = group === 'profile' ? clean[0] : clean;
  }
  return result;
}
