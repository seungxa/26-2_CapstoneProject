import { normalize } from './matching.js';
const KEY='jobseeker.field-mappings.v1';
export function signatureFor(field){return JSON.stringify([normalize(field.label),normalize(field.section),field.kind,field.autocomplete||'',field.controls.map(c=>[c.kind,c.name||'',normalize(c.label),c.maxLength])]);}
export const fieldMappings={
  async find(origin,field,sources,api=chrome){
    if(!origin)return null;
    const data=(await api.storage.local.get(KEY))[KEY]||{};
    const mapping=data[origin]?.[signatureFor(field)];if(!mapping)return null;
    const candidates=sources.filter(source=>source.group===mapping.group&&source.key===mapping.key);
    // Never silently select an index from multiple education/career records.
    return candidates.length===1?candidates[0]:null;
  },
  async save(origin,field,source,api=chrome){
    if(!origin)return;
    const data=(await api.storage.local.get(KEY))[KEY]||{};
    const entries={...(data[origin]||{}),[signatureFor(field)]:{group:source.group,key:source.key}};
    data[origin]=Object.fromEntries(Object.entries(entries).slice(-200));
    await api.storage.local.set({[KEY]:Object.fromEntries(Object.entries(data).slice(-100))});
  },
  async clear(api=chrome){await api.storage.local.remove(KEY);},
  async forget(origin,field,api=chrome){const data=(await api.storage.local.get(KEY))[KEY]||{};if(data[origin])delete data[origin][signatureFor(field)];await api.storage.local.set({[KEY]:data});}
};
