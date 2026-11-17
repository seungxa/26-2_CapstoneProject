// Future Java API integration replaces this repository, not the form executor.
const KEY = 'jobseeker.archive.v1';
export const archiveRepository = {
  async load() {
    const data = (await chrome.storage.local.get(KEY))[KEY];
    return {revision:0, profile:{}, education:[], experience:[], activity:[], award:[], military:[], license:[], language:[], response:[], ...data};
  },
  async save(archive) {
    const current = await this.load();
    const saved = { ...archive, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [KEY]: saved });
    return saved;
  },
  async clear() { await chrome.storage.local.remove(KEY); }
};
