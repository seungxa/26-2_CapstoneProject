export async function connectToTab(api) {
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  return injectIntoTab(api, tab);
}
export async function injectIntoTab(api, tab) {
  if (!Number.isInteger(tab?.id)) throw Error('Open the application tab first.');
  // Tab.url can be withheld without a current host grant. Missing metadata
  // must not be mistaken for a non-web page before injection is attempted.
  if (tab.url && !/^https?:/.test(tab.url)) throw Error('Open a job application page first.');
  let info;
  let stage = 'check page URL';
  try {
    [info] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ url: location.href }) });
    stage = 'load scripts';
    try {
      await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['values.js','widgets.js','content.js','address-agent.js'] });
    } catch {
      await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['values.js','widgets.js','content.js','address-agent.js'] });
    }
  } catch (error) {
    const detail = error?.message || String(error);
    const denied = /cannot access|permission|not allowed|extensions gallery/i.test(detail);
    throw Error(denied ? `Site access blocked. Allow this site for JobSeeker in chrome://extensions, then click the JobSeeker icon. [${stage}] ${detail}` : `Could not start [${stage}]: ${detail}. Reload the extension and the page.`);
  }
  const url = info?.result?.url || tab.url;
  if (!url || !/^https?:/.test(url)) throw Error('Could not read the page. Click the JobSeeker icon again.');
  return { ...tab, url };
}
