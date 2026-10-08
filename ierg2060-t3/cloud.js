// Apps Script's HTML bridge handles Google requests without cross-origin fetch.
export function cloudEndpoint(value) {
  const url = new URL(value);
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)) throw Error('Use the deployed Apps Script Web app URL ending in /exec.');
  return `${url.origin}${url.pathname}`;
}

export function createCloudClient(value) {
  const endpoint=cloudEndpoint(value),url=new URL(endpoint),channel=crypto.randomUUID();
  url.search = new URLSearchParams({channel}).toString(); url.hash = '';
  const frame = document.createElement('iframe');
  frame.hidden = true; frame.title = 'Google Sheets connection'; frame.src = url.href;
  let source = null, origin = null, stopped = false, stopError = null, readyResolve, readyReject;
  const pending = new Map();
  const ready = new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  // A rejected connection is surfaced by call(), even if loading finishes first.
  ready.catch(()=>{});
  const timer = setTimeout(()=>stop(Error('Google sign-in did not finish. Click Sign in with Google, sign in with the instructor account, then return and click Connect. If already signed in, open the sign-in link to check account access.')),30000);
  function stop(error) {
    if(stopped)return;
    stopped=true;stopError=error;clearTimeout(timer);readyReject(error);
    window.removeEventListener('message',receive);frame.remove();
    for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}
    pending.clear();source=null;origin=null;
  }
  function receive(event) {
    const data=event.data;
    if(!data || data.channel!==channel || stopped)return;
    if(!/^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/.test(event.origin))return;
    if(data.type==='ierg-ready'&&!source&&event.source){source=event.source;origin=event.origin;clearTimeout(timer);readyResolve();return;}
    if(event.source!==source||event.origin!==origin||data.type!=='ierg-rpc-result')return;
    const request=pending.get(data.id);if(!request)return;
    pending.delete(data.id);clearTimeout(request.timer);
    if(data.error){const error=Error(typeof data.error==='string'?data.error:data.error.message||'Google Sheets request failed.');error.serverConfirmed=true;request.reject(error);}
    else request.resolve(data.result);
  }
  window.addEventListener('message',receive);document.body.append(frame);
  return {endpoint,async call(action,payload={}) {
    if(stopped)throw stopError;
    await ready;
    if(stopped)throw stopError;
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('No confirmation from Google Sheets. Retry to check the same request.'));},30000);
      pending.set(id,{resolve,reject,timer});
      try{source.postMessage({type:'ierg-rpc',channel,id,action,payload},origin);}
      catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
    });
  },destroy(){stop(Error('Google Sheets connection closed.'));}};
}
