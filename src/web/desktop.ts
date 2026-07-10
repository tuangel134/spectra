/**
 * Desktop-first shell for Spectra.
 *
 * It deliberately wraps the existing battle-tested web UI instead of forking
 * it. The shell adds native-product concerns that do not belong in the shared
 * web client: onboarding, security profiles, Workspace Trust, recovery,
 * connectivity state, and a stable desktop chrome.
 */
export const DESKTOP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Spectra Desktop</title>
<style>
:root{--bg:#080a0f;--panel:#10131b;--panel2:#151925;--line:#272d3d;--text:#f1f4fb;--muted:#929bb0;--accent:#8c7cff;--accent2:#4dd6c7;--danger:#ff6b7a;--warn:#ffca66;--ok:#63dc9a;--bar:48px;--status:25px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--text)}button,select{font:inherit}.app{height:100%;display:grid;grid-template-rows:var(--bar) 1fr var(--status)}
.top{display:flex;align-items:center;gap:10px;padding:0 13px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#111521,#0d1018);user-select:none}.brand{display:flex;align-items:center;gap:9px;font-weight:750;letter-spacing:.2px}.mark{width:23px;height:23px;border-radius:7px;background:conic-gradient(from 210deg,var(--accent),var(--accent2),#5e8cff,var(--accent));box-shadow:0 0 22px #8c7cff40}.project{min-width:0;max-width:42vw;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.spacer{flex:1}.pill,.action,select{border:1px solid var(--line);background:var(--panel2);color:var(--text);border-radius:8px;height:30px;padding:0 10px}.pill{display:flex;align-items:center;gap:7px;font-size:12px}.dot{width:7px;height:7px;border-radius:999px;background:var(--muted)}.dot.ok{background:var(--ok);box-shadow:0 0 10px #63dc9a70}.dot.warn{background:var(--warn)}.dot.bad{background:var(--danger)}.action{cursor:pointer}.action:hover,select:hover{border-color:#4a5270}.action.primary{background:#6e5ee8;border-color:#8d7fff}.action.danger{color:#ffd9de;border-color:#713644;background:#2a151b}
.main{position:relative;min-height:0}.workspace{width:100%;height:100%;border:0;background:var(--bg)}.status{display:flex;align-items:center;gap:14px;padding:0 10px;border-top:1px solid var(--line);background:#0c0f16;color:var(--muted);font-size:11px}.status span{white-space:nowrap}.status .grow{flex:1;overflow:hidden;text-overflow:ellipsis}.banner{position:absolute;z-index:5;left:50%;top:16px;transform:translateX(-50%);display:none;align-items:center;gap:12px;max-width:min(760px,92%);padding:10px 12px;border:1px solid #6b542a;border-radius:10px;background:#251e12e8;box-shadow:0 12px 36px #0008;color:#ffe3a6}.banner.show{display:flex}.banner p{margin:0;font-size:12px;line-height:1.4}.offline{display:none;position:absolute;inset:0;z-index:9;place-items:center;background:#07090dd9;backdrop-filter:blur(6px)}.offline.show{display:grid}.offline-card{width:min(420px,90%);padding:24px;border:1px solid var(--line);border-radius:14px;background:var(--panel);text-align:center;box-shadow:0 20px 70px #000b}.offline-card h2{margin:0 0 8px}.offline-card p{color:var(--muted);font-size:13px}
.modal{display:none;position:fixed;z-index:20;inset:0;align-items:center;justify-content:center;padding:24px;background:#03050acc;backdrop-filter:blur(8px)}.modal.show{display:flex}.dialog{width:min(720px,100%);max-height:88vh;overflow:auto;border:1px solid var(--line);border-radius:16px;background:linear-gradient(160deg,#151927,#0d1018);box-shadow:0 30px 90px #000d}.dialog header{padding:20px 22px 12px}.dialog h2{margin:0 0 7px;font-size:20px}.dialog header p{margin:0;color:var(--muted);font-size:13px;line-height:1.5}.dialog main{padding:12px 22px 20px}.dialog footer{display:flex;justify-content:flex-end;gap:9px;padding:14px 22px;border-top:1px solid var(--line)}.profiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.profile{cursor:pointer;padding:14px;border:1px solid var(--line);border-radius:12px;background:#111521;text-align:left;color:var(--text)}.profile:hover{border-color:#595f80}.profile.selected{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}.profile strong{display:block;margin-bottom:4px}.profile small{display:block;color:var(--muted);line-height:1.45}.profile .tag{display:inline-block;margin-top:9px;padding:3px 7px;border-radius:99px;background:#22283a;color:#cdd3e3;font-size:10px}.findings{margin:14px 0 0;padding:0;list-style:none;border:1px solid var(--line);border-radius:10px;overflow:hidden}.findings li{display:flex;gap:10px;align-items:center;padding:9px 11px;border-bottom:1px solid var(--line);font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.findings li:last-child{border-bottom:0}.finding-kind{min-width:58px;color:var(--warn);text-transform:uppercase;font-size:10px}.empty{padding:18px;color:var(--muted);text-align:center}.trust-state{display:flex;align-items:center;gap:9px;margin:4px 0 14px;padding:10px 12px;border-radius:10px;background:#0c0f17;border:1px solid var(--line)}
@media(max-width:780px){.project{display:none}.top .pill span.label{display:none}.profiles{grid-template-columns:1fr}.dialog{max-height:94vh}.top{gap:6px;padding:0 7px}.action,.pill,select{padding:0 7px}}
</style>
</head>
<body>
<div class="app">
  <div class="top">
    <div class="brand"><span class="mark"></span><span>Spectra</span></div>
    <div class="project" id="project">Loading workspace…</div>
    <div class="spacer"></div>
    <div class="pill" title="Core connectivity"><span class="dot" id="coreDot"></span><span class="label" id="coreText">Core</span></div>
    <button class="pill action" id="trustButton" title="Workspace Trust"><span class="dot warn" id="trustDot"></span><span class="label" id="trustText">Trust</span></button>
    <select id="profileSelect" aria-label="Security profile"></select>
    <button class="action" id="securityButton">Security</button>
  </div>
  <div class="main">
    <div class="banner" id="recoveryBanner"><p><strong>Interrupted run found.</strong> Spectra can resume it from the last durable checkpoint.</p><button class="action primary" id="resumeButton">Resume</button><button class="action" id="dismissRecovery">Later</button></div>
    <iframe class="workspace" id="workspace" title="Spectra workspace" src="/"></iframe>
    <div class="offline" id="offline"><div class="offline-card"><h2>Reconnecting to Spectra Core</h2><p>The desktop shell is still running. Your persisted session and autorun checkpoints are safe.</p><button class="action primary" id="retryButton">Retry now</button></div></div>
  </div>
  <div class="status"><span id="modeStatus">Profile: loading</span><span id="trustStatus">Workspace: checking</span><span class="grow" id="pathStatus"></span><span id="clock"></span></div>
</div>

<div class="modal" id="onboardingModal" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle">
  <div class="dialog"><header><h2 id="onboardingTitle">How should Spectra work for you?</h2><p>Choose a starting profile. You can change it any time without reinstalling or losing project settings.</p></header><main><div class="profiles" id="onboardingProfiles"></div></main><footer><button class="action primary" id="finishOnboarding" disabled>Use selected profile</button></footer></div>
</div>

<div class="modal" id="securityModal" role="dialog" aria-modal="true" aria-labelledby="securityTitle">
  <div class="dialog"><header><h2 id="securityTitle">Workspace security</h2><p>Spectra fingerprints executable project integrations. Trust is invalidated automatically when those files change.</p></header><main><div class="trust-state"><span class="dot" id="modalTrustDot"></span><div><strong id="modalTrustTitle">Checking…</strong><div id="modalTrustDescription" style="color:var(--muted);font-size:12px;margin-top:2px"></div></div></div><ul class="findings" id="findings"></ul></main><footer><button class="action danger" id="restrictButton">Restricted mode</button><span class="spacer"></span><button class="action" id="closeSecurity">Close</button><button class="action" id="trustOnceButton">Trust once</button><button class="action primary" id="trustPermanentButton">Trust permanently</button></footer></div>
</div>

<script>
(function(){
  'use strict';
  var TOKEN=__SPECTRA_AUTH_TOKEN__||new URLSearchParams(location.search).get('token')||'';
  var state={security:null,profiles:[],selected:null,online:true};
  function el(id){return document.getElementById(id)}
  function api(path,options){
    options=options||{};
    options.headers=Object.assign({'content-type':'application/json'},options.headers||{},TOKEN?{'authorization':'Bearer '+TOKEN}:{});
    return fetch(path,options).then(function(res){if(!res.ok)return res.json().catch(function(){return{error:res.statusText}}).then(function(body){throw new Error(body.error||res.statusText)});return res.json()})
  }
  function post(path,body){return api(path,{method:'POST',body:JSON.stringify(body||{})})}
  function setOnline(ok){state.online=ok;el('coreDot').className='dot '+(ok?'ok':'bad');el('coreText').textContent=ok?'Core ready':'Core offline';el('offline').classList.toggle('show',!ok)}
  function profileCard(profile,selected){var button=document.createElement('button');button.className='profile'+(selected?' selected':'');button.dataset.id=profile.id;button.innerHTML='<strong>'+escapeHtml(profile.name)+'</strong><small>'+escapeHtml(profile.description)+'</small><span class="tag">'+(profile.autoApprove?'Autonomous':'Supervised')+'</span>';return button}
  function escapeHtml(value){return String(value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function renderProfiles(){
    var select=el('profileSelect');select.innerHTML='';
    if(state.security&&state.security.profile==='legacy'){var legacy=document.createElement('option');legacy.value='legacy';legacy.textContent='Choose security profile…';legacy.disabled=true;select.appendChild(legacy)}
    state.profiles.filter(function(p){return p.id!=='legacy'}).forEach(function(p){var option=document.createElement('option');option.value=p.id;option.textContent=p.name;select.appendChild(option)});
    if(state.security)select.value=state.security.profile;
    var box=el('onboardingProfiles');box.innerHTML='';
    state.profiles.filter(function(p){return p.id!=='legacy'}).forEach(function(p){var card=profileCard(p,state.selected===p.id);card.onclick=function(){state.selected=p.id;renderProfiles();el('finishOnboarding').disabled=false};box.appendChild(card)});
  }
  function renderSecurity(){
    var data=state.security;if(!data)return;
    var trust=data.trust;var trusted=trust.trusted;
    el('trustDot').className='dot '+(trusted?'ok':'warn');
    el('trustText').textContent=trusted?(trust.state==='implicit'?'No executable assets':'Trusted'):(trust.state==='changed'?'Changed':'Restricted');
    el('modeStatus').textContent='Profile: '+data.profile+(state.core?' · Core '+(state.core.managed?'persistent':'embedded'):'');
    el('trustStatus').textContent='Workspace: '+trust.state;
    el('pathStatus').textContent=trust.projectRoot;
    el('project').textContent=trust.projectRoot;
    el('profileSelect').value=data.profile;
    el('modalTrustDot').className='dot '+(trusted?'ok':'warn');
    el('modalTrustTitle').textContent=trusted?'Workspace is trusted':'Workspace is restricted';
    el('modalTrustDescription').textContent=trust.findings.length===0?'No executable Spectra, Claude, OpenCode, or MCP assets were detected.':trust.findings.length+' executable integration asset(s) detected. '+(trust.state==='changed'?'The fingerprint changed since you trusted it.':'');
    var findings=el('findings');findings.innerHTML='';
    if(!trust.findings.length){findings.innerHTML='<li class="empty">Nothing executable was detected in this workspace.</li>'}
    trust.findings.forEach(function(f){var li=document.createElement('li');li.innerHTML='<span class="finding-kind">'+escapeHtml(f.kind)+'</span><span>'+escapeHtml(f.path)+'</span>';findings.appendChild(li)});
    el('trustOnceButton').disabled=trusted;
    el('trustPermanentButton').disabled=trust.permanent;
    el('restrictButton').disabled=!trusted&&trust.state!=='changed';
  }
  function refreshSecurity(){return api('/api/security/status').then(function(data){state.security=data;state.profiles=data.profiles||[];if(data.profile==='legacy'&&!state.selected){state.selected='balanced';el('finishOnboarding').disabled=false}renderProfiles();renderSecurity();if(data.profile==='legacy')el('onboardingModal').classList.add('show')})}
  function refreshRecovery(){return Promise.all([api('/api/autorun'),api('/api/core/status')]).then(function(values){var data=values[0],core=values[1];state.core=core;el('recoveryBanner').classList.toggle('show',!!data.hasResumable&&!data.running||!!(core.recovery&&core.recovery.interrupted&&!data.running));if(state.security)renderSecurity()})}
  function refresh(){return Promise.all([refreshSecurity(),refreshRecovery()]).then(function(){setOnline(true)}).catch(function(){setOnline(false)})}
  el('profileSelect').onchange=function(){var profile=this.value;post('/api/security/profile',{profile:profile}).then(refreshSecurity).catch(function(err){alert(err.message)})};
  el('finishOnboarding').onclick=function(){if(!state.selected)return;post('/api/security/profile',{profile:state.selected}).then(function(){el('onboardingModal').classList.remove('show');return refreshSecurity()}).catch(function(err){alert(err.message)})};
  el('securityButton').onclick=function(){el('securityModal').classList.add('show')};el('trustButton').onclick=el('securityButton').onclick;el('closeSecurity').onclick=function(){el('securityModal').classList.remove('show')};
  function trust(action){post('/api/security/trust',{action:action}).then(function(){return refreshSecurity()}).then(function(){el('workspace').contentWindow.location.reload()}).catch(function(err){alert(err.message)})}
  el('trustOnceButton').onclick=function(){trust('once')};el('trustPermanentButton').onclick=function(){trust('permanent')};el('restrictButton').onclick=function(){trust('restrict')};
  el('resumeButton').onclick=function(){post('/api/autorun/resume',{}).then(function(){el('recoveryBanner').classList.remove('show');el('workspace').contentWindow.location.reload()}).catch(function(err){alert(err.message)})};el('dismissRecovery').onclick=function(){el('recoveryBanner').classList.remove('show')};el('retryButton').onclick=refresh;
  setInterval(function(){api('/health').then(function(){setOnline(true)}).catch(function(){setOnline(false)})},5000);
  setInterval(function(){refreshSecurity().catch(function(){setOnline(false)})},8000);
  setInterval(function(){el('clock').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})},1000);
  window.addEventListener('online',refresh);window.addEventListener('offline',function(){setOnline(false)});
  refresh();
})();
</script>
</body>
</html>`
