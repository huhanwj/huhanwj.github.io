// Apps Script's HTML bridge handles Google requests without cross-origin fetch.
export function createCloudClient(value) {
  const url = new URL(value);
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)) throw Error('Use the deployed Apps Script Web app URL ending in /exec.');
  const endpoint = `${url.origin}${url.pathname}`, channel = crypto.randomUUID();
  url.search = new URLSearchParams({channel}).toString(); url.hash = '';
  const frame = document.createElement('iframe');
  frame.hidden = true; frame.title = 'Google Sheets connection'; frame.src = url.href;
  let source = null, origin = null, stopped = false, readyResolve, readyReject;
  const pending = new Map();
  const ready = new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  // A rejected connection is surfaced by call(), even if loading finishes first.
  ready.catch(()=>{});
  const timer = setTimeout(()=>readyReject(Error('Google Sheets did not connect. Check the Web app deployment and access settings.')),30000);
  function receive(event) {
    const data=event.data;
    if(!data || data.channel!==channel || stopped)return;
    if(!/^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/.test(event.origin))return;
    if(data.type==='ierg-ready'&&!source){source=event.source;origin=event.origin;clearTimeout(timer);readyResolve();return;}
    if(event.source!==source||event.origin!==origin||data.type!=='ierg-rpc-result')return;
    const request=pending.get(data.id);if(!request)return;
    pending.delete(data.id);clearTimeout(request.timer);
    if(data.error){const error=Error(typeof data.error==='string'?data.error:data.error.message||'Google Sheets request failed.');error.serverConfirmed=true;request.reject(error);}
    else request.resolve(data.result);
  }
  window.addEventListener('message',receive);document.body.append(frame);
  return {endpoint,async call(action,payload={}) {
    if(stopped)throw Error('Google Sheets connection is closed.');
    await ready;
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('No confirmation from Google Sheets. Retry to check the same request.'));},30000);
      pending.set(id,{resolve,reject,timer});
      source.postMessage({type:'ierg-rpc',channel,id,action,payload},origin);
    });
  },destroy(){stopped=true;clearTimeout(timer);readyReject(Error('Google Sheets connection closed.'));window.removeEventListener('message',receive);frame.remove();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Google Sheets connection closed.'));}pending.clear();}};
}
