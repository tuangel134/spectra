/**
 * Self-contained web UI for Spectra (also rendered inside the desktop app).
 *
 * Visual language and structure adapted from SpecForge: a header with mode +
 * model, a spec-phases bar, a chat column, and a right panel with real tabs
 * (Activity, Specs, Tasks, Files, Logs, Permissions, Config) — all backed by
 * Spectra's real engine via /api. A composer with a slash-command menu that
 * filters as you type.
 */

export const WEB_HTML = String.raw`<!doctype html>
<html lang="es" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Spectra</title>
<style>
  :root {
    --bg: oklch(0.13 0.015 280); --panel: oklch(0.17 0.018 280); --panel2: oklch(0.21 0.020 280);
    --border: oklch(0.28 0.018 280); --border-strong: oklch(0.36 0.024 280);
    --primary: oklch(0.65 0.22 295); --primary-soft: oklch(0.65 0.22 295 / 0.15);
    --accent: oklch(0.78 0.15 200); --accent-soft: oklch(0.78 0.15 200 / 0.15);
    --emerald: oklch(0.72 0.17 155); --emerald-soft: oklch(0.72 0.17 155 / 0.15);
    --rose: oklch(0.68 0.22 18); --rose-soft: oklch(0.68 0.22 18 / 0.15);
    --text: oklch(0.96 0.005 280); --dim: oklch(0.70 0.012 280); --faint: oklch(0.48 0.012 280);
    --radius: 8px;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--text);
    font: 12.5px/1.55 ui-monospace, "JetBrains Mono", Menlo, monospace; }
  .app { display: grid; grid-template-rows: 48px auto 1fr 24px; height: 100vh; }
  kbd { font: inherit; font-size: 10px; padding: 1px 5px; border-radius: 5px; background: var(--panel2); border: 1px solid var(--border); color: var(--dim); }
  ::-webkit-scrollbar { width: 9px; height: 9px; } ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 5px; }
  @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  @keyframes slideDown { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.6} }

  /* Header */
  header { position: relative; display: flex; align-items: center; gap: 8px; padding: 0 12px;
    background: color-mix(in oklch, var(--panel) 82%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
  header::after { content:""; position:absolute; bottom:0; left:0; right:0; height:1px; background: linear-gradient(90deg, transparent, var(--primary), transparent); opacity:.4; }
  .brand { display:flex; align-items:center; gap:8px; user-select:none; }
  .logo { width:26px; height:26px; border-radius:7px; display:grid; place-items:center; font-weight:800; color:#fff;
    background: linear-gradient(135deg, var(--primary), oklch(0.55 0.20 250)); box-shadow: 0 0 14px var(--primary-soft); }
  .brand .name { font-weight:700; background: linear-gradient(90deg, var(--primary), var(--accent)); -webkit-background-clip:text; background-clip:text; color:transparent; line-height:1; }
  .brand .sub { font-size:9.5px; color:var(--faint); line-height:1.2; }
  .vline { width:1px; height:20px; background:var(--border); }
  .pill { display:flex; align-items:center; gap:6px; padding:5px 10px; border-radius:var(--radius); border:1px solid var(--border); background:var(--panel2); color:var(--text); cursor:pointer; font:inherit; position:relative; transition:border-color .15s, box-shadow .15s; }
  .pill:hover { border-color:var(--primary); box-shadow:0 0 8px var(--primary-soft); }
  .pill .dot { width:6px; height:6px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent); }
  .grow { flex:1; }
  .iconbtn { padding:6px; border-radius:var(--radius); border:1px solid var(--border); background:var(--panel2); color:var(--faint); cursor:pointer; font:inherit; transition:color .15s, border-color .15s, box-shadow .15s; }
  .iconbtn:hover { color:var(--accent); border-color:var(--accent); box-shadow:0 0 8px var(--accent-soft); }
  .menu { position:absolute; top:calc(100% + 4px); left:0; min-width:260px; background:var(--panel2); border:1px solid var(--border-strong); border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,.5); z-index:50; overflow:hidden; display:none; }
  .menu.open { display:block; animation:slideDown .2s ease-out; }
  .menu .mi { padding:8px 11px; cursor:pointer; display:flex; gap:8px; align-items:flex-start; }
  .menu .mi:hover { background:var(--panel); }
  .menu .mi .t { color:var(--text); }
  .menu .mi .d { color:var(--faint); font-size:10px; }
  .menu .mi .rwx { margin-left:auto; display:flex; gap:3px; }
  .menu .mi .rwx span { font-size:8px; padding:1px 4px; border-radius:4px; background:var(--panel); color:var(--faint); }
  .menu .mi .rwx .on.r { background:var(--accent-soft); color:var(--accent); }
  .menu .mi .rwx .on.w { background:var(--primary-soft); color:var(--primary); }
  .menu .mi .rwx .on.b { background:var(--rose-soft); color:var(--rose); }

  /* Spec phases bar */
  .phases { display:flex; align-items:center; gap:0; padding:6px 12px; background:var(--panel); border-bottom:1px solid var(--border); overflow-x:auto; }
  .phase { display:flex; align-items:center; gap:6px; font-size:10px; color:var(--faint); white-space:nowrap; }
  .phase .n { width:16px; height:16px; border-radius:50%; display:grid; place-items:center; font-size:9px; border:1px solid var(--border); }
  .phase.active .n { background:var(--primary); color:#fff; border-color:var(--primary); }
  .phase.done .n { background:var(--emerald); color:#06120c; border-color:var(--emerald); }
  .phase.active { color:var(--text); }
  .phase-sep { width:18px; height:1px; background:var(--border); margin:0 6px; }

  /* Body */
  .body { display:grid; grid-template-columns: 1fr 380px; overflow:hidden; }
  .left { display:grid; grid-template-rows: 1fr auto; overflow:hidden; }
  .chat { overflow-y:auto; padding:20px 26px; }
  .right { border-left:1px solid var(--border); background:var(--panel); display:grid; grid-template-rows:auto 1fr; overflow:hidden; }
  .tabs { display:flex; overflow-x:auto; border-bottom:1px solid var(--border); }
  .tabmore { position:relative; margin-left:auto; }
  .tabmore .menu { left:auto; right:0; min-width:150px; }
  .tab { padding:8px 11px; font-size:11px; color:var(--dim); border-right:1px solid var(--border); cursor:pointer; white-space:nowrap; display:flex; gap:5px; align-items:center; background:none; border-top:0; border-left:0; transition:color .15s, background .15s; }
  .tab:hover { color:var(--text); background:var(--panel2); }
  .tab.active { color:var(--primary); background:var(--panel2); box-shadow: inset 0 -2px 0 var(--primary); }
  .tab .badge { font-size:9px; padding:0 5px; border-radius:5px; background:var(--panel); color:var(--faint); }
  .tabbody { overflow-y:auto; padding:14px; }
  .tabbody h3 { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--faint); margin:0 0 10px; }

  .empty { color:var(--faint); text-align:center; margin-top:16vh; }
  .msg { margin:0 0 18px; max-width:820px; animation:fadeIn .25s ease-out; }
  .msg .who { font-size:10.5px; color:var(--faint); margin-bottom:4px; font-weight:600; letter-spacing:.3px; }
  .msg.user .who { color:var(--accent); } .msg.assistant .who { color:var(--primary); }
  .msg .bubble { white-space:pre-wrap; word-wrap:break-word; line-height:1.6; }
  .msg .bubble p { margin:0 0 8px; } .msg .bubble p:last-child { margin:0; }
  .msg .bubble pre { background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:10px; overflow-x:auto; margin:8px 0; font-size:11.5px; white-space:pre; }
  .msg .bubble code { font-family:inherit; font-size:11.5px; background:var(--panel2); padding:1px 4px; border-radius:4px; }
  .msg .bubble pre code { background:none; padding:0; }
  .msg .bubble ul, .msg .bubble ol { margin:4px 0 8px 18px; padding:0; }
  .msg .bubble li { margin:2px 0; }
  .msg .bubble h1,.msg .bubble h2,.msg .bubble h3 { font-size:13px; margin:12px 0 4px; color:var(--primary); }
  .msg .bubble blockquote { border-left:3px solid var(--primary); margin:8px 0; padding:4px 10px; color:var(--dim); }
  .msg .bubble a { color:var(--accent); text-decoration:underline; }
  .msg.tool .bubble { color:var(--dim); font-size:11.5px; } .msg.system .bubble { color:var(--accent); font-style:italic; }

  .card { background:var(--panel2); border:1px solid var(--border); border-radius:10px; padding:12px; display:flex; gap:10px; align-items:flex-start; transition:border-color .2s, box-shadow .2s; animation:fadeIn .3s ease-out; }
  .card:hover { border-color:var(--primary); box-shadow:0 0 12px var(--primary-soft); }
  .card .badge2 { width:28px; height:28px; border-radius:7px; display:grid; place-items:center; background:var(--emerald-soft); color:var(--emerald); }
  .card .t { font-weight:600; } .card .d { color:var(--faint); font-size:11px; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:12px 0; }
  .stat { background:var(--panel2); border:1px solid var(--border); border-radius:9px; padding:10px 6px; text-align:center; }
  .stat .n { font-size:17px; font-weight:700; } .stat .l { font-size:9px; color:var(--faint); text-transform:uppercase; }
  .stat.thinking .n{color:var(--primary)} .stat.exec .n{color:var(--accent)} .stat.done .n{color:var(--emerald)} .stat.err .n{color:var(--rose)}
  .bar { height:5px; border-radius:4px; background:var(--panel2); overflow:hidden; } .bar > i { display:block; height:100%; width:0%; background:linear-gradient(90deg,var(--primary),var(--accent),var(--emerald)); transition:width .3s; }
  .row { padding:8px 10px; border:1px solid var(--border); border-radius:8px; margin-bottom:6px; background:var(--panel2); }
  .row .top { display:flex; gap:8px; align-items:center; }
  .row .mut { color:var(--faint); font-size:10px; }
  .tag { font-size:9px; padding:1px 6px; border-radius:5px; }
  .tag.ok { background:var(--emerald-soft); color:var(--emerald); } .tag.error { background:var(--rose-soft); color:var(--rose); }
  .tag.created { background:var(--emerald-soft); color:var(--emerald); } .tag.modified { background:var(--accent-soft); color:var(--accent); } .tag.deleted { background:var(--rose-soft); color:var(--rose); }
  .tas\\: {}
  .taskline { display:flex; gap:8px; align-items:center; padding:4px 0; }
  .taskline .box { width:14px; }
  pre.diff { background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:10px; overflow-x:auto; font-size:11px; white-space:pre; }
  .ins { color:var(--emerald); } .del { color:var(--rose); }
  .log .row { color:var(--dim); }

  /* Composer */
  .composer-wrap { border-top:1px solid var(--border); background:var(--panel); padding:10px 12px; position:relative; }
  .composer { display:flex; align-items:flex-end; gap:8px; border:1px solid var(--border); background:var(--panel2); border-radius:var(--radius); padding:8px 10px; }
  .composer:focus-within { border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-soft); transition:border-color .2s, box-shadow .2s; }
  .composer .corner { color:var(--faint); margin-top:2px; }
  textarea { flex:1; resize:none; background:transparent; color:var(--text); border:0; outline:none; font:inherit; min-height:22px; max-height:160px; padding:2px 0; }
  .sendbtn { background:var(--primary); color:#0c0a14; border:0; border-radius:6px; padding:6px 10px; cursor:pointer; font-weight:700; }
  .sendbtn:disabled { opacity:.35; cursor:default; }
  .hints { display:flex; gap:12px; flex-wrap:wrap; padding:6px 2px 0; color:var(--faint); font-size:10px; align-items:center; }
  .slash { position:absolute; left:12px; right:12px; bottom:calc(100% - 4px); margin-bottom:6px; background:var(--panel2); border:1px solid var(--border); border-radius:10px; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.5); max-height:280px; overflow-y:auto; display:none; }
  .slash.open { display:block; }
  .slash .sh { padding:6px 10px; font-size:10px; color:var(--faint); border-bottom:1px solid var(--border); }
  .slash .it { display:flex; align-items:center; gap:10px; padding:7px 12px; cursor:pointer; }
  .slash .it.active { background:var(--panel); }
  .slash .it code { color:var(--primary); width:150px; flex-shrink:0; } .slash .it .d { color:var(--dim); flex:1; } .slash .it .cat { font-size:9px; text-transform:uppercase; padding:1px 6px; border-radius:5px; background:var(--panel); color:var(--faint); }

  /* Status bar */
  .statusbar { display:flex; align-items:center; gap:14px; padding:0 12px; border-top:1px solid var(--border); background:var(--bg); color:var(--faint); font-size:10px; }
  .statusbar .st { color:var(--emerald); } .statusbar .mode { color:var(--primary); text-transform:uppercase; }
  .conn-lost { display:none; color:var(--rose); font-weight:600; animation:pulse 1.5s infinite; }
  .conn-lost.on { display:inline; }

  /* Modal */
  .modal-bg { position:fixed; inset:0; background:rgba(0,0,0,.65); display:none; align-items:center; justify-content:center; z-index:60; }
  .modal-bg.open { display:flex; animation:fadeIn .15s ease-out; }
  .modal { background:var(--panel); border:1px solid var(--border-strong); border-radius:14px; width:600px; max-width:92vw; max-height:82vh; display:flex; flex-direction:column; overflow:hidden; backdrop-filter:blur(12px); animation:slideDown .2s ease-out; }
  .modal h2 { margin:0; padding:14px 16px; border-bottom:1px solid var(--border); font-size:14px; }
  .modal .search { padding:10px 14px; border-bottom:1px solid var(--border); }
  .modal .search input { width:100%; background:var(--panel2); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:9px 11px; font:inherit; outline:none; }
  .modal .list { overflow-y:auto; padding:6px; }
  .opt { display:flex; justify-content:space-between; align-items:center; padding:9px 12px; border-radius:8px; cursor:pointer; } .opt:hover { background:var(--panel2); }
  .opt .badge3 { font-size:9.5px; padding:2px 7px; border-radius:6px; }
  .badge3.free { background:var(--emerald-soft); color:var(--emerald); } .badge3.ready { background:var(--accent-soft); color:var(--accent); } .badge3.key { background:var(--primary-soft); color:var(--primary); }
  .keyrow { padding:12px 16px; border-top:1px solid var(--border); display:none; gap:8px; } .keyrow.open { display:flex; }
  .keyrow input { flex:1; background:var(--panel2); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:9px 11px; font:inherit; }
  .keyrow button { background:var(--primary); color:#0c0a14; border:0; border-radius:8px; padding:0 14px; cursor:pointer; font-weight:700; }

  /* Command palette (Ctrl/Cmd+K) */
  .pal { width:620px; }
  .pal .list { max-height:54vh; }
  .palit { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:8px; cursor:pointer; }
  .palit.active, .palit:hover { background:var(--primary-soft); }
  .palit .pi { width:20px; text-align:center; color:var(--primary); }
  .palit code { font-size:11px; color:var(--text); }
  .palit .pd { color:var(--dim); font-size:11px; flex:1; }
  .palit .pcat { font-size:9px; text-transform:uppercase; letter-spacing:.05em; color:var(--faint); border:1px solid var(--border); border-radius:5px; padding:1px 6px; }
  .palsec { padding:8px 12px 4px; font-size:9.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); }

  /* Theme picker */
  .theme-opt.active { background:var(--primary-soft); }
  .theme-opt .swatches { display:inline-flex; gap:3px; }
  .theme-opt .swatches i { width:13px; height:13px; border-radius:3px; border:1px solid rgba(128,128,128,.35); }

  /* Shortcuts overlay (?) */
  .shov { position:fixed; inset:0; background:rgba(0,0,0,.7); display:none; align-items:center; justify-content:center; z-index:70; }
  .shov.open { display:flex; animation:fadeIn .15s ease-out; }
  .shov .card { background:var(--panel); border:1px solid var(--border-strong); border-radius:14px; width:560px; max-width:92vw; padding:18px 20px; animation:slideDown .2s ease-out; }
  .shov h2 { margin:0 0 12px; font-size:14px; }
  .shov .grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 24px; }
  .shov .srow { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .shov .srow span { color:var(--dim); font-size:11.5px; }

  /* Toasts */
  .toasts { position:fixed; bottom:34px; right:16px; display:flex; flex-direction:column; gap:8px; z-index:80; pointer-events:none; }
  .toast { background:var(--panel2); border:1px solid var(--border-strong); border-left:3px solid var(--primary); border-radius:8px; padding:9px 13px; min-width:200px; max-width:340px; box-shadow:0 8px 28px rgba(0,0,0,.4); animation:slideDown .18s ease-out; font-size:11.5px; }
  .toast.ok { border-left-color:var(--emerald); } .toast.err { border-left-color:var(--rose); } .toast.warn { border-left-color:#f5a623; }
  .toast .tt { color:var(--text); }

  /* Usage / token chart */
  .donut-wrap { display:flex; align-items:center; gap:18px; padding:8px 2px 14px; }
  .donut { flex:0 0 auto; }
  .ulegend { display:flex; flex-direction:column; gap:7px; font-size:11.5px; }
  .ulegend .lr { display:flex; align-items:center; gap:8px; }
  .ulegend .sw { width:11px; height:11px; border-radius:3px; flex:0 0 auto; }
  .ulegend b { color:var(--text); } .ulegend .mut { color:var(--dim); }
  .ubars { display:flex; flex-direction:column; gap:10px; margin-top:6px; }
  .ubar { }
  .ubar .ut { display:flex; justify-content:space-between; font-size:11px; color:var(--dim); margin-bottom:3px; }
  .ubar .utk { background:var(--panel2); border:1px solid var(--border); border-radius:6px; height:9px; overflow:hidden; }
  .ubar .utk i { display:block; height:100%; background:linear-gradient(90deg,var(--primary),var(--accent)); }
  .ucards { display:flex; gap:8px; flex-wrap:wrap; margin:4px 0 6px; }
  .ucard { flex:1; min-width:96px; background:var(--panel2); border:1px solid var(--border); border-radius:9px; padding:9px 11px; }
  .ucard .n { font-size:18px; font-weight:700; color:var(--text); } .ucard .l { font-size:10px; color:var(--faint); text-transform:uppercase; letter-spacing:.05em; }
  .ucard .n.sav { color:var(--emerald); }

  /* Problems panel */
  .pbhd { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
  .pb { border:1px solid var(--border); border-radius:9px; padding:9px 11px; margin-bottom:7px; background:var(--panel2); }
  .pb .pbt { display:flex; align-items:center; gap:8px; }
  .pb .sev { font-size:9px; text-transform:uppercase; letter-spacing:.05em; padding:1px 7px; border-radius:5px; }
  .sev.err { background:var(--rose-soft); color:var(--rose); } .sev.warn { background:#f5a62322; color:#f5a623; } .sev.ok { background:var(--emerald-soft); color:var(--emerald); }
  .pb .pbloc { color:var(--dim); font-size:10.5px; } .pb pre { margin:6px 0 0; max-height:160px; overflow:auto; }

  /* Config controls */
  .cfgsec { margin-bottom:18px; }
  .cfgrow { display:flex; align-items:center; gap:8px; padding:7px 10px; border:1px solid var(--border); border-radius:8px; background:var(--panel2); margin-bottom:6px; transition:border-color .15s, box-shadow .15s; }
  .cfgrow:hover { border-color:color-mix(in oklch, var(--primary) 40%, var(--border)); }
  .cfgrow .mut { font-size:10px; }
  .btn { background:var(--primary); color:#0c0a14; border:0; border-radius:6px; padding:5px 11px; cursor:pointer; font:inherit; font-weight:700; }
  .btn:hover { filter:brightness(1.1); }
  .btn.ghost { background:transparent; color:var(--dim); border:1px solid var(--border); font-weight:400; }
  .btn.ghost:hover { color:var(--rose); border-color:var(--rose); }
  .sel { background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:4px 8px; font:inherit; }
  .num { width:90px; background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:4px 8px; font:inherit; }
  .form { display:flex; flex-direction:column; gap:6px; margin-top:8px; padding:10px; border:1px dashed var(--border); border-radius:8px; }
  .form input, .form textarea { background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:7px 9px; font:inherit; outline:none; }
  .form input:focus, .form textarea:focus { border-color:var(--primary); }
  .form textarea { min-height:70px; resize:vertical; }
  .dot2 { width:7px; height:7px; border-radius:50%; background:var(--faint); flex-shrink:0; } .dot2.on { background:var(--emerald); box-shadow:0 0 7px var(--emerald); }
  .switch { position:relative; display:inline-block; width:38px; height:20px; } .switch input { display:none; }
  .switch .track { position:absolute; inset:0; background:var(--border-strong); border-radius:20px; transition:.2s; cursor:pointer; }
  .switch .track::before { content:""; position:absolute; width:14px; height:14px; left:3px; top:3px; background:#fff; border-radius:50%; transition:.2s; }
  .btn.big { padding:8px 16px; font-size:13px; }
  #autopilotBtn { transition: all .2s; }
  #autopilotBtn.apon { background:var(--primary); color:#0c0a14; border-color:var(--primary); box-shadow:0 0 14px var(--primary); font-weight:700; }
  #autopilotBtn.aprun { border-color:var(--emerald); color:var(--emerald); box-shadow:0 0 10px var(--emerald); }
  .apcard { padding:14px; border:1px solid var(--primary); border-radius:10px; background:linear-gradient(160deg,var(--panel2),var(--panel)); margin-bottom:12px; }
  .aphd { display:flex; align-items:center; gap:8px; } .aptitle { font-weight:800; font-size:14px; }
  .aptag { color:#0c0a14; font-weight:700; font-size:10px; padding:2px 8px; border-radius:20px; text-transform:uppercase; letter-spacing:.5px; }
  .apdesc { color:var(--dim); font-size:11px; line-height:1.5; margin-top:8px; }
  .apph { width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; background:var(--panel); border:1px solid var(--border); flex-shrink:0; }
  .apph.completed { background:var(--emerald); color:#0c0a14; border-color:var(--emerald); }
  .apph.in_progress,.apph.fixing,.apph.verifying { background:var(--primary); color:#0c0a14; border-color:var(--primary); }
  .apph.failed { background:var(--rose); color:#fff; border-color:var(--rose); }
  .aplog { max-height:320px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; padding:8px; background:var(--panel); font-size:11px; }
  .apev { padding:2px 0; line-height:1.5; border-bottom:1px solid var(--panel2); }
  .apev.error { color:var(--rose); } .apev.success { color:var(--emerald); } .apev.warn { color:#f5a623; }
  .apev.phase { color:var(--primary); font-weight:600; } .apev.research { color:#22d3ee; } .apev.fix,.apev.verify { color:#a78bfa; }
  .imgtray { display:flex; flex-wrap:wrap; gap:6px; padding:0 4px 4px; }
  .imgchip { font-size:11px; background:var(--panel2); border:1px solid var(--border); border-radius:14px; padding:3px 9px; color:var(--dim); }
  .imgchip b { cursor:pointer; color:var(--rose); margin-left:4px; }
  .ed { display:flex; height:100%; gap:0; }
  .edtree { width:210px; min-width:160px; overflow-y:auto; border-right:1px solid var(--border); padding:4px; }
  .edfile { font-size:11px; padding:3px 6px; border-radius:5px; cursor:pointer; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .edfile:hover { background:var(--panel2); color:var(--text); } .edfile.on { background:var(--primary); color:#0c0a14; }
  .edmain { flex:1; display:flex; flex-direction:column; min-width:0; }
  .edbar { display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid var(--border); }
  .edhost { flex:1; min-height:300px; }
  .msg.working { border-left:2px solid var(--primary); padding-left:8px; margin:6px 0; animation:fadeIn .2s ease-out; }
  .msg.working .who { color:var(--primary); font-weight:600; display:flex; align-items:center; gap:6px; animation:pulse 1.5s infinite; }
  .msg.working.done { border-color:var(--emerald); } .msg.working.done .who { color:var(--emerald); animation:none; }
  .msg.working .steps { max-height:160px; overflow-y:auto; font-size:11px; color:var(--dim); padding:4px 0; }
  .wstep { padding:1px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .wstep::before { content:"› "; color:var(--faint); }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner { display:inline-block; width:12px; height:12px; border:2px solid var(--primary); border-top-color:transparent; border-radius:50%; animation:spin .6s linear infinite; }
  .stopbtn { background:var(--rose); color:#fff; border:0; border-radius:6px; padding:6px 10px; cursor:pointer; font:inherit; font-weight:700; font-size:13px; transition:transform .1s, box-shadow .15s; }
  .stopbtn:hover { transform:scale(1.08); box-shadow:0 0 12px var(--rose-soft); }
  .queue-bar { font-size:10px; padding:2px 8px; color:var(--dim); display:none; }
  .queue-bar.on { display:block; }
  .searchbar { display:none; position:absolute; top:8px; right:12px; z-index:10; background:var(--panel2); border:1px solid var(--border); border-radius:8px; padding:4px 8px; gap:6px; align-items:center; box-shadow:0 4px 16px rgba(0,0,0,.4); animation:slideDown .15s ease-out; }
  .searchbar.on { display:flex; }
  .searchbar input { background:transparent; border:0; color:var(--text); font:inherit; outline:none; width:200px; }
  .searchbar button { background:none; border:0; color:var(--faint); cursor:pointer; font-size:14px; }
  .msg.search-hide { display:none; }
  .switch input:checked + .track { background:var(--primary); } .switch input:checked + .track::before { transform:translateX(18px); }
</style>
</head>
<script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/highlight.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark.min.css">
<body>
<div class="app">
  <header>
    <div class="brand"><div class="logo">◆</div><div><div class="name">Spectra</div><div class="sub">v0.1.0 · spec-driven</div></div></div>
    <div class="vline"></div>
    <button class="pill" id="modePill"><span style="color:var(--primary)">⬡</span><span id="modeName">Plan</span><span style="color:var(--faint)">▾</span>
      <div class="menu" id="modeMenu"></div>
    </button>
    <button class="pill" id="modelPill"><span class="dot"></span><span id="modelName">…</span></button>
    <button class="pill" id="routePill" title="Model routing — how Spectra picks a model per task"><span style="color:var(--primary)">⚖</span><span id="routeName">Manual</span><span style="color:var(--faint)">▾</span>
      <div class="menu" id="routeMenu"></div>
    </button>
    <button class="pill" id="autopilotBtn" title="Long-Running / Full-Stack autonomous mode" style="border-color:var(--primary)"><span style="color:var(--primary)">🚀</span><span id="autopilotLbl">Full-Stack</span></button>
    <button class="pill" id="githubBtn" title="Push this project to GitHub" style="border-color:var(--emerald)"><span style="color:var(--emerald)">⬆</span><span>Push to GitHub</span></button>
    <div class="grow"></div>
    <button class="iconbtn" id="connectBtn" title="Connect a provider">⚙</button>
    <button class="iconbtn" id="paletteBtn" title="Command palette (Ctrl/⌘K)">⌘</button>
  </header>

  <div class="phases" id="phases"></div>

  <div class="body">
    <div class="left">
      <div class="chat" id="chat"><div class="empty" id="empty">No messages yet. Describe a task, or type <kbd>/</kbd> for commands.</div></div>
      <div class="searchbar" id="searchBar"><input id="searchInput" placeholder="Search chat…" /><button id="searchClose">✕</button></div>
      <div class="composer-wrap">
        <div class="slash" id="slash"></div>
        <div class="queue-bar" id="queueBar"></div>
        <div class="imgtray" id="imgtray"></div>
        <div class="composer"><span class="corner">⌅</span>
          <textarea id="input" rows="1" placeholder='Message Spectra…  ·  / commands  ·  @ files  ·  ! shell'></textarea>
          <button class="sendbtn" id="sendBtn">Send</button><button class="stopbtn" id="stopBtn" style="display:none" title="Interrupt">■</button></div>
        <div class="hints"><span><kbd>↵</kbd> send</span><span><kbd>⇧↵</kbd> newline</span><span><kbd>/</kbd> commands</span><span><kbd>Ctrl+K</kbd> palette</span><span><kbd>Ctrl+F</kbd> search</span><span><kbd>?</kbd> shortcuts</span></div>
      </div>
    </div>

    <div class="right">
      <div class="tabs" id="tabs"></div>
      <div class="tabbody" id="tabbody"></div>
    </div>
  </div>

  <div class="statusbar">
    <span class="conn-lost" id="connLost">⚠ Connection lost — retrying…</span>
    <span class="st" id="sbConn">● ready</span><span class="mode" id="sbMode">plan</span>
    <span class="grow"></span><span id="sbTok">0↑ 0↓</span><span>spectra v0.1.0</span>
  </div>
</div>

<div class="modal-bg" id="modelModal"><div class="modal">
  <h2>Select a model</h2>
  <div class="search"><input id="modelSearch" placeholder="Filter models…" /></div>
  <div class="list" id="modelList"></div>
  <div class="keyrow" id="keyRow"><input id="keyInput" type="password" placeholder="API key" /><button id="keySave">Save & use</button></div>
</div></div>

<div class="modal-bg" id="ghModal"><div class="modal">
  <h2>🚀 Push to GitHub</h2>
  <div class="search"><input id="ghDesc2" placeholder="One-line description (optional)" /></div>
  <div style="padding:10px 14px;color:var(--dim)"><label><input type="checkbox" id="ghPrivate2" /> Private repository</label></div>
  <div class="keyrow open" style="border-top:1px solid var(--border)"><button class="btn" id="ghPushBtn" style="flex:1">🚀 Create repo & push</button></div>
</div></div>

<div class="modal-bg" id="paletteModal"><div class="modal pal">
  <div class="search"><input id="palInput" placeholder="Type a command or action…  (Esc to close)" /></div>
  <div class="list" id="palList"></div>
</div></div>

<div class="modal-bg" id="themeModal"><div class="modal">
  <h2>Theme</h2>
  <div class="list" id="themeList"></div>
</div></div>

<div class="shov" id="shortcutsOverlay"><div class="card">
  <h2>⌨ Keyboard shortcuts</h2>
  <div class="grid">
    <div class="srow"><span>Command palette</span><kbd>Ctrl/⌘ K</kbd></div>
    <div class="srow"><span>Search chat</span><kbd>Ctrl/⌘ F</kbd></div>
    <div class="srow"><span>Slash commands</span><kbd>/</kbd></div>
    <div class="srow"><span>Send message</span><kbd>↵</kbd></div>
    <div class="srow"><span>New line</span><kbd>⇧ ↵</kbd></div>
    <div class="srow"><span>Interrupt turn</span><kbd>Esc</kbd></div>
    <div class="srow"><span>New session</span><kbd>Ctrl/⌘ N</kbd></div>
    <div class="srow"><span>This help</span><kbd>?</kbd></div>
  </div>
</div></div>

<div class="toasts" id="toasts"></div>


<script>
const $=(id)=>document.getElementById(id);
const PHASES=["intake","requirements","analysis","design","tasks","approval","execution","verification","review"];
const MODES=[
 {id:"plan",label:"Plan",agent:"plan",r:1,w:0,b:0,d:"Read-only analysis. Default for new projects."},
 {id:"chat",label:"Chat",agent:"plan",r:1,w:0,b:0,d:"Conversational. Ask, explain, ideate."},
 {id:"spec",label:"Spec",agent:"spec",r:1,w:1,b:0,d:"Full spec-driven flow: requirements → design → tasks."},
 {id:"build",label:"Build",agent:"build",r:1,w:1,b:1,d:"Execute tasks with full tool access."},
 {id:"review",label:"Review",agent:"review",r:1,w:0,b:0,d:"Audit: security, perf, architecture, tests."},
 {id:"security",label:"Security",agent:"security",r:1,w:1,b:1,d:"🛡 Scan the whole project for vulnerabilities, then fix on your approval."},
];
const ROUTES=[
 {id:"manual",label:"Manual",icon:"●",d:"One model for everything."},
 {id:"auto",label:"Auto",icon:"⚖",d:"Cheapest capable model per step."},
 {id:"tiered",label:"Tiered",icon:"🎚",d:"By task difficulty: easy→cheap, hard→pricey."},
 {id:"semi",label:"Semi",icon:"🎯",d:"Pick a model per task type."},
];
let routing={mode:"manual",assignments:{},autochange:{enabled:false,fallbacks:[]},tiers:{}};
let state={agent:"build",model:"",agents:[],catalog:[],commands:[],mode:"plan"};
let stats={think:0,exec:0,done:0,err:0,in:0,out:0};
let pendingModel=null, slashItems=[], slashIndex=0, activeTab="activity", currentSpec=null;
let autopilotMode=false;
let pendingImages=[];
function renderPendingImages(){ const el=$("imgtray"); if(!el) return;
  el.innerHTML=pendingImages.map((im,i)=>'<span class="imgchip">🖼 '+(im.name||("image "+(i+1)))+' <b data-imgdel="'+i+'">×</b></span>').join("");
  el.querySelectorAll("[data-imgdel]").forEach(b=>b.onclick=()=>{ pendingImages.splice(Number(b.dataset.imgdel),1); renderPendingImages(); });
}
function fileToImage(file){ return new Promise((resolve)=>{ const r=new FileReader(); r.onload=()=>{ const s=String(r.result||""); const m=s.match(/^data:([^;]+);base64,(.*)$/); if(m) resolve({mediaType:m[1],data:m[2],name:file.name}); else resolve(null); }; r.onerror=()=>resolve(null); r.readAsDataURL(file); }); }
async function addImageFiles(files){ for(const f of files){ if(!f.type.startsWith("image/")) continue; const im=await fileToImage(f); if(im) pendingImages.push(im); } renderPendingImages(); }

const jget=(u)=>fetch(u,{headers:{"authorization":"Bearer "+(typeof __TOKEN!=="undefined"?__TOKEN:"")}}).then(r=>{connOk();return r.json()}).catch(e=>{connFail(e);return{}});
const jpost=(u,b)=>fetch(u,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+(typeof __TOKEN!=="undefined"?__TOKEN:"")},body:JSON.stringify(b)}).then(r=>{connOk();return r}).catch(e=>{connFail(e);return{body:{getReader:()=>({read:async()=>({done:true,value:undefined})})},json:async()=>({})}});
function connOk(){ const el=$("connLost"); if(el) el.classList.remove("on"); }
function connFail(e){ const el=$("connLost"); if(el) el.classList.add("on"); console.warn("Spectra connection error:",e); }

async function loadState(){
  const s=await jget("/api/state");
  state.agent=s.agent; state.model=s.model; state.agents=s.agents;
  $("modelName").textContent=s.model; $("sbTok").textContent=stats.in+"↑ "+stats.out+"↓";
  $("sbConn").textContent=s.connected?"● ready":"○ offline"; $("sbConn").style.color=s.connected?"var(--emerald)":"var(--faint)";
}
async function loadCatalog(){ state.catalog=await jget("/api/catalog"); }
async function loadCommands(){ state.commands=await jget("/api/commands"); }
async function loadHistory(){
  const d=await jget("/api/session");
  if(d&&Array.isArray(d.messages)&&d.messages.length){
    clearEmpty();
    for(const m of d.messages){ addMsg(m.role==="assistant"?"assistant":m.role==="user"?"user":"system", m.content); }
    addMsg("system","⟲ Resumed your last session — continue where you left off.");
  }
}

// ── Modes ──
function renderModeMenu(){
  $("modeMenu").innerHTML=MODES.map(m=>'<div class="mi" data-id="'+m.id+'"><div><div class="t">'+m.label+'</div><div class="d">'+m.d+'</div></div>'+
    '<div class="rwx"><span class="'+(m.r?"on r":"")+'">R</span><span class="'+(m.w?"on w":"")+'">W</span><span class="'+(m.b?"on b":"")+'">$</span></div></div>').join("");
  $("modeMenu").querySelectorAll(".mi").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); setMode(el.dataset.id); $("modeMenu").classList.remove("open"); });
}
async function setMode(id){
  const m=MODES.find(x=>x.id===id); if(!m) return;
  state.mode=id; $("modeName").textContent=m.label; $("sbMode").textContent=id;
  await jpost("/api/agent",{agent:m.agent}); await loadState();
}

// ── Routing pill (manual / auto / tiered / semi + Autochange) ──
async function loadRouting(){
  const r=await jget("/api/routing");
  if(r&&r.routing){ routing=r.routing; if(!routing.autochange) routing.autochange={enabled:false,fallbacks:[]}; if(!routing.tiers) routing.tiers={}; }
  const lbl=(ROUTES.find(x=>x.id===routing.mode)||ROUTES[0]).label;
  if($("routeName")) $("routeName").textContent=lbl;
  renderRouteMenu();
}
function renderRouteMenu(){
  const m=$("routeMenu"); if(!m) return;
  const ac=routing.autochange||{enabled:false,fallbacks:[]};
  m.innerHTML=
    ROUTES.map(x=>'<div class="mi" data-id="'+x.id+'"><div><div class="t">'+x.icon+' '+x.label+(routing.mode===x.id?'  ✓':'')+'</div><div class="d">'+x.d+'</div></div></div>').join("")+
    '<div class="mi" id="rMenuAuto" style="border-top:1px solid var(--border)"><div><div class="t">↪ Autochange failover</div><div class="d">'+(ac.enabled?'ON — switches model on token/quota out':'OFF — tap to enable')+'</div></div><div class="rwx"><span class="'+(ac.enabled?'on w':'')+'">'+(ac.enabled?'ON':'OFF')+'</span></div></div>'+
    '<div class="mi" id="rMenuCfg" style="border-top:1px solid var(--border)"><div><div class="t">⚙ Configure models, tiers & fallbacks →</div><div class="d">open routing settings</div></div></div>';
  m.querySelectorAll(".mi[data-id]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); setRouteMode(el.dataset.id); });
  const au=$("rMenuAuto"); if(au) au.onclick=(e)=>{ e.stopPropagation(); toggleAutochange(); };
  const cf=$("rMenuCfg"); if(cf) cf.onclick=(e)=>{ e.stopPropagation(); $("routeMenu").classList.remove("open"); activeTab="config"; renderTab(); setTimeout(()=>{ const el=document.getElementById("rtMode"); if(el) el.scrollIntoView({behavior:"smooth",block:"center"}); },120); };
}
async function setRouteMode(id){
  routing.mode=id;
  const lbl=(ROUTES.find(x=>x.id===id)||ROUTES[0]).label;
  if($("routeName")) $("routeName").textContent=lbl;
  await jpost("/api/routing",{mode:id});
  renderRouteMenu();
  if(id==="tiered"&&!(routing.tiers&&(routing.tiers.easy||routing.tiers.medium||routing.tiers.hard))){
    addMsg("system","🎚 Tiered routing on. Set which model handles easy/medium/hard tasks in ⚙ → Model routing (or the menu's Configure link).");
  }
  if(id==="semi"){ addMsg("system","🎯 Semi routing on. Assign a model per task type in ⚙ → Model routing."); }
}
async function toggleAutochange(){
  const ac=routing.autochange||{enabled:false,fallbacks:[]};
  ac.enabled=!ac.enabled; routing.autochange=ac;
  await jpost("/api/routing",{autochange:{enabled:ac.enabled}});
  renderRouteMenu();
  if(ac.enabled&&(!ac.fallbacks||!ac.fallbacks.length)){
    addMsg("system","↪ Autochange enabled. Add up to 3 fallback models (ideally on a different provider) in ⚙ → Model routing so long tasks survive a token/quota block.");
  }
}

// ── Spec phases bar ──
function renderPhases(activeIdx){
  $("phases").innerHTML=PHASES.map((p,i)=>{
    const cls=i<activeIdx?"done":i===activeIdx?"active":"";
    const sym=i<activeIdx?"✓":String(i+1).padStart(2,"0");
    return (i>0?'<div class="phase-sep"></div>':'')+'<div class="phase '+cls+'"><span class="n">'+sym+'</span>'+p+'</div>';
  }).join("");
}

// ── Right panel tabs ──
const TABS=[
 {id:"activity",label:"Activity",pri:1},{id:"projects",label:"Projects",pri:1},{id:"editor",label:"Editor",pri:1},
 {id:"files",label:"Files",pri:1},{id:"diff",label:"Diff",pri:1},{id:"tasks",label:"Tasks",pri:1},{id:"problems",label:"Problems",pri:1},{id:"config",label:"Config",pri:1},
 {id:"specs",label:"Specs"},{id:"usage",label:"Usage"},{id:"logs",label:"Logs"},{id:"audit",label:"Audit"},{id:"timeline",label:"Timeline"},{id:"permissions",label:"Perms"},{id:"memory",label:"Memory"},
];
function renderTabs(badges){
  const pri=TABS.filter(t=>t.pri), sec=TABS.filter(t=>!t.pri);
  const activeInSec=sec.some(t=>t.id===activeTab);
  const tb=(t)=>'<button class="tab '+(t.id===activeTab?"active":"")+'" data-id="'+t.id+'">'+t.label+(badges[t.id]?'<span class="badge">'+badges[t.id]+'</span>':'')+'</button>';
  let html=pri.map(tb).join("");
  const moreLbl=activeInSec?(sec.find(t=>t.id===activeTab).label):"More";
  const secBadges=sec.reduce((n,t)=>n+(badges[t.id]||0),0);
  html+='<div class="tabmore"><button class="tab '+(activeInSec?"active":"")+'" id="tabMoreBtn">'+moreLbl+(secBadges&&!activeInSec?'<span class="badge">'+secBadges+'</span>':'')+' ▾</button>'+
    '<div class="menu" id="tabMoreMenu">'+sec.map(t=>'<div class="mi" data-id="'+t.id+'"><div class="t">'+t.label+(badges[t.id]?'  ('+badges[t.id]+')':'')+'</div></div>').join("")+'</div></div>';
  $("tabs").innerHTML=html;
  $("tabs").querySelectorAll(".tab[data-id]").forEach(b=>b.onclick=()=>{ activeTab=b.dataset.id; renderTab(); });
  const mb=$("tabMoreBtn"); if(mb) mb.onclick=(e)=>{ e.stopPropagation(); $("tabMoreMenu").classList.toggle("open"); };
  $("tabs").querySelectorAll("#tabMoreMenu .mi").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); activeTab=el.dataset.id; renderTab(); });
}
function refreshStats(){
  const total=stats.done+stats.err+stats.exec||1;
  if(activeTab==="activity") renderTab();
  $("sbTok").textContent=stats.in+"↑ "+stats.out+"↓";
  void total;
}
async function renderTab(){
  const body=$("tabbody"); const badges={};
  if(activeTab==="activity"){
    body.innerHTML='<div class="card"><div class="badge2">◆</div><div><div class="t">Orchestrator</div><div class="d">Decides when to ask, plan, design, execute, stop.</div></div></div>'+
     '<h3 style="margin-top:16px">activity stats</h3><div class="stats">'+
     '<div class="stat thinking"><div class="n">'+stats.think+'</div><div class="l">thinking</div></div>'+
     '<div class="stat exec"><div class="n">'+stats.exec+'</div><div class="l">executing</div></div>'+
     '<div class="stat done"><div class="n">'+stats.done+'</div><div class="l">done</div></div>'+
     '<div class="stat err"><div class="n">'+stats.err+'</div><div class="l">errors</div></div></div>'+
     '<div class="bar"><i style="width:'+Math.min(100,(stats.done/(stats.done+stats.err+stats.exec||1))*100)+'%"></i></div>';
  } else if(activeTab==="projects"){
    await renderProjects(body);
  } else if(activeTab==="editor"){
    await renderEditor(body);
  } else if(activeTab==="specs"){
    const {specs}=await jget("/api/specs"); badges.specs=specs.length;
    body.innerHTML=specs.length?specs.map(s=>'<div class="row" data-spec="'+s.id+'"><div class="top"><b>'+s.title+'</b><span class="grow"></span><span class="mut">'+s.done+'/'+s.tasks+'</span></div><div class="mut">'+s.type+' · '+s.id+'</div></div>').join(""):'<div class="empty">No specs yet. Use /spec to create one.</div>';
    body.querySelectorAll("[data-spec]").forEach(el=>el.onclick=()=>openSpec(el.dataset.spec));
  } else if(activeTab==="tasks"){
    if(!currentSpec){ const {specs}=await jget("/api/specs"); if(specs[0]) currentSpec=specs[0].id; }
    if(!currentSpec){ body.innerHTML='<div class="empty">No spec selected.</div>'; }
    else { const d=await jget("/api/specs/"+currentSpec);
      body.innerHTML='<h3>'+(d.meta?d.meta.title:currentSpec)+'</h3>'+(d.tasks&&d.tasks.length?d.tasks.map(t=>
        '<div class="taskline"><span class="box">'+(t.status==="completed"?"✅":t.status==="in_progress"?"🔄":t.status==="failed"?"❌":"⬜")+'</span><span>Task '+t.id+': '+t.title+'</span></div>').join(""):'<div class="empty">No tasks.</div>'); }
  } else if(activeTab==="files"){
    const {files}=await jget("/api/files"); badges.files=files.length;
    body.innerHTML=files.length?files.map(f=>'<div class="row"><div class="top"><span class="tag '+f.status+'">'+f.status+'</span><span>'+f.path+'</span></div></div>').join(""):'<div class="empty">No files changed this session.</div>';
  } else if(activeTab==="diff"){
    const {files}=await jget("/api/files");
    body.innerHTML=files.length?files.map(f=>'<h3>'+f.path+'</h3>'+renderDiff(f.before,f.after)).join(""):'<div class="empty">No changes to diff.</div>';
  } else if(activeTab==="logs"){
    const {logs}=await jget("/api/logs"); badges.logs=logs.length;
    body.innerHTML=logs.length?[...logs].reverse().map(l=>'<div class="row log"><div class="top"><span class="tag '+l.status+'">'+l.status+'</span><b>'+l.tool+'</b><span class="grow"></span><span class="mut">'+new Date(l.timestamp).toLocaleTimeString()+'</span></div><div class="mut">'+esc(l.args)+'</div></div>').join(""):'<div class="empty">No tool calls yet.</div>';
  } else if(activeTab==="permissions"){
    const {permissions}=await jget("/api/permissions");
    body.innerHTML='<h3>permissions</h3>'+Object.entries(permissions).map(([k,v])=>'<div class="row"><div class="top"><b>'+k+'</b><span class="grow"></span><span class="tag '+(typeof v==="string"&&v==="deny"?"error":"ok")+'">'+(typeof v==="string"?v:"rules")+'</span></div></div>').join("");
  } else if(activeTab==="memory"){
    const {memory}=await jget("/api/memory");
    const ent=(await jget("/api/memory/entries")).memory||[];
    let html='';
    if(ent.length){ html+='<h3>project memory ('+ent.length+')</h3>'+ent.map(e=>'<div class="cfgrow"><span class="tag ok">'+e.kind+'</span><b>'+esc(e.text)+'</b>'+((e.tags||[]).length?'<span class="mut"> #'+e.tags.join(" #")+'</span>':'')+'<span class="grow"></span><button class="btn ghost" data-memdel="'+e.id+'">forget</button></div>').join(""); }
    else { html+='<div class="mut" style="padding:4px 0">No structured memory yet. The agent stores decisions/conventions/APIs via the memory tool.</div>'; }
    html+=memory.length?memory.map(m=>'<h3 style="margin-top:14px">'+m.name+'</h3><pre class="diff">'+esc(m.content)+'</pre>').join(""):'';
    body.innerHTML=html;
    body.querySelectorAll("[data-memdel]").forEach(b=>b.onclick=async()=>{ await jpost("/api/memory/forget",{id:b.dataset.memdel}); renderTab(); });
  } else if(activeTab==="timeline"){
    const {timeline}=await jget("/api/timeline");
    if(!timeline.length){ body.innerHTML='<div class="empty">No snapshots yet. Edits create restore points you can rewind to.</div>'; }
    else { body.innerHTML='<h3>timeline ('+timeline.length+' snapshots)</h3>'+timeline.slice().reverse().map(s=>'<div class="cfgrow"><span class="mut">'+new Date(s.timestamp).toLocaleTimeString()+'</span><b>'+s.files.length+' file(s)</b><span class="mut">'+esc(s.files.slice(0,3).join(", "))+'</span><span class="grow"></span><button class="btn ghost" data-rewind="'+s.id+'">rewind here</button></div>').join("");
      body.querySelectorAll("[data-rewind]").forEach(b=>b.onclick=async()=>{ if(!confirm("Rewind to this point? Newer changes will be reverted.")) return; const r=await jpost("/api/timeline/restore",{id:b.dataset.rewind}).then(x=>x.json()); addMsg("system","⟲ Rewound "+r.snapshots+" snapshot(s), "+r.reverted+" file change(s) reverted."); renderTab(); }); }
  } else if(activeTab==="audit"){
    const {audit}=await jget("/api/audit"); badges.audit=audit.length;
    body.innerHTML='<h3>audit log</h3>'+(audit.length?audit.map(a=>'<div class="row"><div class="top"><span class="tag ok">'+a.category+'</span><b>'+esc(a.action)+'</b><span class="grow"></span><span class="mut">'+new Date(a.timestamp).toLocaleTimeString()+'</span></div>'+(a.detail?'<div class="mut">'+esc(a.detail)+'</div>':'')+'</div>').join(""):'<div class="empty">No audit events yet.</div>');
  } else if(activeTab==="usage"){
    await renderUsage(body);
  } else if(activeTab==="problems"){
    await renderProblems(body);
  } else if(activeTab==="config"){
    const st=await jget("/api/state");
    const settings=await jget("/api/settings");
    const hooks=(await jget("/api/hooks")).hooks||[];
    const steering=(await jget("/api/steering")).steering||[];
    const mcp=(await jget("/api/mcp")).servers||[];
    const skills=(await jget("/api/skills")).skills||[];
    const plugins=(await jget("/api/plugins")).plugins||[];
    const hr=await jget("/api/headroom");
    const routing=await jget("/api/routing");
    body.innerHTML=renderConfig(st,settings,hooks,steering,mcp,hr,skills,plugins,routing);
    wireConfig();
  }
  renderTabs(badges);
}
function renderConfig(st,settings,hooks,steering,mcp,hr,skills,plugins,routing){
  const rt=(routing&&routing.routing)||{mode:"manual",assignments:{},autochange:{enabled:false,fallbacks:[]}};
  const rModels=(routing&&routing.models)||[];
  const rKinds=(routing&&routing.taskKinds)||["default","plan","build","fix","research","verify","subagent","summary"];
  const modelOpts=(sel)=>'<option value="">'+(sel?"":"(main model)")+'</option>'+rModels.map(m=>'<option '+(m===sel?"selected":"")+'>'+m+'</option>').join("");
  const fb=(rt.autochange&&rt.autochange.fallbacks)||[];
  const tiers=rt.tiers||{};
  const lvls=settings.permissionLevels||["allow","ask","deny"];
  const perms=settings.permission||{}; const tools=settings.toolNames||[];
  const c=settings.compaction||{auto:true,reserved:10000};
  const h=(hr&&hr.config)||settings.headroom||{enabled:true,minTokens:200,reversible:true,persist:true};
  const hs=(hr&&hr.stats)||{compressedPayloads:0,originalTokens:0,compressedTokens:0,stored:0};
  const saved=Math.max(0,(hs.originalTokens||0)-(hs.compressedTokens||0));
  const pct=hs.originalTokens?Math.round(saved/hs.originalTokens*100):0;
  const prov=st.providers.map(p=>'<div class="cfgrow"><span class="dot2 '+(p.connected?"on":"")+'"></span><b>'+p.name+'</b><span class="mut">'+p.id+'</span><span class="grow"></span>'+
    (p.connected
      ? '<button class="btn ghost" data-disc="'+p.id+'">Disconnect</button>'
      : (p.id==="free"?'<span class="tag ok">always free</span>':'<button class="btn" data-conn="'+p.id+'">Connect</button>'))+'</div>').join("");
  const permRows=tools.map(t=>'<div class="cfgrow"><b>'+t+'</b><span class="grow"></span><select class="sel" data-perm="'+t+'">'+
    lvls.map(l=>'<option '+((typeof perms[t]==="string"?perms[t]:"allow")===l?"selected":"")+'>'+l+'</option>').join("")+'</select></div>').join("");
  const steerRows=steering.length?steering.map(f=>'<div class="cfgrow"><b>'+f.name+'</b><span class="grow"></span><button class="btn ghost" data-steerdel="'+f.name+'">Delete</button></div>').join(""):'<div class="mut" style="padding:4px 0">No steering files.</div>';
  const mcpRows=mcp.length?mcp.map(m=>'<div class="cfgrow"><span class="dot2 '+(m.connected?"on":"")+'"></span><b>'+m.name+'</b><span class="mut">'+(m.type||"stdio")+(m.connected?" · "+(m.toolCount||0)+" tools":m.error?" · "+esc(m.error.slice(0,40)):" · not connected")+'</span><span class="grow"></span><button class="btn ghost" data-mcpdel="'+m.name+'">Remove</button></div>').join(""):'<div class="mut" style="padding:4px 0">No MCP servers.</div>';
  const skillRows=(skills&&skills.length)?skills.map(s=>'<div class="cfgrow"><b>'+esc(s.name)+'</b><span class="mut">'+esc((s.description||"").slice(0,70))+'</span><span class="grow"></span><span class="tag ok">'+s.source+'</span></div>').join(""):'<div class="mut" style="padding:4px 0">No skills. Add one at .spectra/skills/&lt;name&gt;/SKILL.md</div>';
  const hookRows=hooks.length?hooks.map(h=>'<div class="cfgrow"><b>'+h.name+'</b><span class="tag ok">'+h.event+'→'+h.action+'</span><span class="grow"></span><button class="btn ghost" data-hookdel="'+h.name+'">Remove</button></div>').join(""):'<div class="mut" style="padding:4px 0">No hooks.</div>';
  return ''+
  sect("Model","<div class=cfgrow><b id=cfgModel style=cursor:pointer>"+st.model+"</b><span class=grow></span><button class=btn id=cfgChangeModel>Change…</button></div>")+
  sect("Providers",prov)+
  sect("Add custom provider (OpenAI-compatible)",
    '<div class="form"><input id="cpId" placeholder="provider id (e.g. my-api)"><input id="cpUrl" placeholder="base URL (https://host/v1)"><input id="cpKey" type="password" placeholder="API key (optional)"><input id="cpModel" placeholder="default model id"><button class="btn" id="cpAdd">Add provider</button></div>')+
  sect("Context compaction",
    '<div class="cfgrow"><b>Auto-compact memory</b><span class="mut">summarize old turns near the context limit</span><span class="grow"></span>'+
    '<label class="switch"><input type="checkbox" id="cpAuto" '+(c.auto?"checked":"")+'><span class="track"></span></label></div>'+
    '<div class="cfgrow"><b>Reserved tokens</b><span class="grow"></span><input class="num" id="cpReserved" type="number" value="'+(c.reserved||10000)+'"><button class="btn" id="cpSaveComp">Save</button></div>')+
  sect("Headroom — token compression",
    '<div class="cfgrow"><b>Compress tool output</b><span class="mut">shrink JSON / logs before they hit the model · reversible</span><span class="grow"></span>'+
    '<label class="switch"><input type="checkbox" id="hrEnabled" '+(h.enabled?"checked":"")+'><span class="track"></span></label></div>'+
    '<div class="cfgrow"><b>Reversible (cache originals)</b><span class="mut">model can call headroom_retrieve</span><span class="grow"></span>'+
    '<label class="switch"><input type="checkbox" id="hrReversible" '+(h.reversible?"checked":"")+'><span class="track"></span></label></div>'+
    '<div class="cfgrow"><b>Persist originals on disk</b><span class="mut">survive memory eviction + restarts · off = memory-only, purges disk</span><span class="grow"></span>'+
    '<label class="switch"><input type="checkbox" id="hrPersist" '+(h.persist!==false?"checked":"")+'><span class="track"></span></label></div>'+
    '<div class="cfgrow"><b>Min tokens to compress</b><span class="grow"></span><input class="num" id="hrMin" type="number" value="'+(h.minTokens||200)+'"><button class="btn" id="hrSave">Save</button></div>'+
    '<div class="cfgrow"><span class="tag '+(saved>0?"ok":"")+'">saved ~'+saved+' tok ('+pct+'%)</span><span class="mut">'+(hs.compressedPayloads||0)+' payloads compressed · '+(hs.stored||0)+' originals cached</span></div>')+
  sect("Model routing",
    '<div class="cfgrow"><b>Mode</b><span class="grow"></span><select class="sel" id="rtMode">'+
      ['manual','semi','auto','tiered'].map(m=>'<option '+(rt.mode===m?"selected":"")+'>'+m+'</option>').join("")+'</select></div>'+
    '<div class="mut" style="padding:2px 2px 8px">manual = one model · semi = pick a model per task · auto = cheapest capable per step · tiered = by task difficulty (easy→cheap, hard→expensive)</div>'+
    '<div id="rtSemi" style="'+(rt.mode==="semi"?"":"display:none")+'">'+
      rKinds.map(k=>'<div class="cfgrow"><b>'+k+'</b><span class="grow"></span><select class="sel rtAssign" data-kind="'+k+'">'+modelOpts((rt.assignments||{})[k])+'</select></div>').join("")+
    '</div>'+
    '<div id="rtTiers" style="'+(rt.mode==="tiered"?"":"display:none")+'">'+
      '<div class="cfgrow"><b>🟢 Easy</b><span class="mut">trivial: renames, typos, formatting</span><span class="grow"></span><select class="sel rtTier" data-tier="easy">'+modelOpts(tiers.easy)+'</select></div>'+
      '<div class="cfgrow"><b>🟡 Medium</b><span class="mut">normal build/fix work</span><span class="grow"></span><select class="sel rtTier" data-tier="medium">'+modelOpts(tiers.medium)+'</select></div>'+
      '<div class="cfgrow"><b>🔴 Hard</b><span class="mut">architecture, algorithms, debugging</span><span class="grow"></span><select class="sel rtTier" data-tier="hard">'+modelOpts(tiers.hard)+'</select></div>'+
    '</div>'+
    '<div class="cfgrow"><b>Autochange (token failover)</b><span class="mut">switch model automatically when tokens/quota run out</span><span class="grow"></span>'+
      '<label class="switch"><input type="checkbox" id="rtAuto" '+(rt.autochange&&rt.autochange.enabled?"checked":"")+'><span class="track"></span></label></div>'+
    '<div class="cfgrow"><b>Fallback 1</b><span class="grow"></span><select class="sel" id="rtFb0">'+modelOpts(fb[0])+'</select></div>'+
    '<div class="cfgrow"><b>Fallback 2</b><span class="grow"></span><select class="sel" id="rtFb1">'+modelOpts(fb[1])+'</select></div>'+
    '<div class="cfgrow"><b>Fallback 3</b><span class="grow"></span><select class="sel" id="rtFb2">'+modelOpts(fb[2])+'</select></div>'+
    '<div class="cfgrow"><span class="mut">main model: '+(routing&&routing.mainModel||"")+'</span><span class="grow"></span><button class="btn" id="rtSave">Save routing</button></div>')+
  sect("Spec auto-detection",
    '<div class="cfgrow"><b>When you describe a build</b><span class="mut">ask = offer questions · auto = Spectra decides · off = never</span><span class="grow"></span><select class="sel" id="specDetect">'+
      ['ask','auto','off'].map(m=>'<option '+(((settings.spec&&settings.spec.detect)||"ask")===m?"selected":"")+'>'+m+'</option>').join("")+'</select></div>')+
  sect("Supervised mode",
    '<div class="cfgrow"><b>Approve tool actions</b><span class="mut">ask before edits / writes / shell commands · off = auto-approve (Autopilot always runs unattended)</span><span class="grow"></span>'+
    '<label class="switch"><input type="checkbox" id="superviseToggle" '+(settings.autoApprove===false?"checked":"")+'><span class="track"></span></label></div>')+
  sect("Permissions",permRows)+
  sect("Steering files",steerRows+'<div class="form"><input id="stName" placeholder="name (e.g. standards)"><textarea id="stContent" placeholder="markdown content"></textarea><button class="btn" id="stAdd">Add steering</button></div>')+
  sect("MCP servers",mcpRows+'<div class="form"><input id="mcName" placeholder="name (e.g. postgres)"><input id="mcCmd" placeholder="command (e.g. uvx)"><input id="mcArgs" placeholder="args (space-separated)"><button class="btn" id="mcAdd">Add server</button></div>')+
  sect("Skills",skillRows+'<div class="cfgrow"><span class="mut">drop a SKILL.md folder in .spectra/skills, .claude/skills or .opencode/skill</span><span class="grow"></span><button class="btn ghost" id="skReload">Reload</button></div>')+
  sect("Hooks",hookRows+'<div class="form"><input id="hkName" placeholder="hook name"><select class="sel" id="hkEvent"><option>fileEdited</option><option>fileCreated</option><option>postToolUse</option><option>preToolUse</option><option>postTaskExecution</option><option>userTriggered</option></select><input id="hkPat" placeholder="patterns (e.g. *.ts,*.tsx)"><select class="sel" id="hkAction"><option>runCommand</option><option>askAgent</option></select><input id="hkCmd" placeholder="command or prompt"><button class="btn" id="hkAdd">Add hook</button></div>')+
  sect("Plugins",((plugins&&plugins.length)?plugins.map(p=>'<div class="cfgrow"><span class="dot2 '+(p.error?"":"on")+'"></span><b>'+esc(p.name)+'</b><span class="mut">'+(p.error?esc(p.error.slice(0,50)):"+"+(p.tools||[]).length+" tools")+'</span></div>').join(""):'<div class="mut" style="padding:4px 0">No plugins. Drop a .js/.mjs file in .spectra/plugins that default-exports function({registerTool}).</div>'))+
  sect("GitHub",
    '<div class="cfgrow"><b>GitHub Token</b><span class="mut">for Push to GitHub (PAT with repo scope)</span><span class="grow"></span><input id="ghToken" type="password" placeholder="ghp_…" style="width:180px"><button class="btn" id="ghTokenSave">Save</button></div>');
}
function sect(title,inner){ return '<div class="cfgsec"><h3>'+title+'</h3>'+inner+'</div>'; }

// ── Monaco editor tab ──
let monacoReady=false, monacoEditor=null, edCurrentFile=null, edFiles=[];

// ── Projects tab ──
async function openProject(path){
  addMsg("system","Opening project "+path+"…");
  const r=await jpost("/api/projects/open",{path}).then(x=>x.json()).catch(()=>({error:"request failed"}));
  if(r.error){ addMsg("system","Couldn't open: "+r.error); return; }
  await afterProjectSwitch(r.current);
}
async function afterProjectSwitch(current){
  $("chat").innerHTML='<div class="empty" id="empty">No messages yet.</div>'; workingEl=null;
  stats={think:0,exec:0,done:0,err:0,in:0,out:0};
  await loadState(); await loadCatalog(); await loadHistory();
  addMsg("system","✓ Now working in project: "+current);
  renderTab();
}
async function renderProjects(body){
  const d=await jget("/api/projects"); const projects=d.projects||[]; const current=d.current||"";
  let html='<div class="cfgrow"><b>Current project:</b><span class="mut">'+esc(current)+'</span></div>';
  html+='<h3 style="margin-top:14px">your projects</h3>';
  if(projects.length){
    html+=projects.map(p=>{ const isCur=p.path===current;
      return '<div class="cfgrow'+(isCur?" active":"")+'"><b>'+esc(p.name)+'</b><span class="mut">'+esc(p.path)+'</span><span class="grow"></span>'+
      (isCur?'<span class="tag ok">● current</span>':'<button class="btn" data-prjopen="'+esc(p.path)+'">Open</button>')+
      '<button class="btn ghost" data-prjrm="'+esc(p.path)+'" title="Remove from list">✕</button></div>';
    }).join("");
  } else { html+='<div class="mut" style="padding:4px 0">No projects registered yet.</div>'; }
  html+='<h3 style="margin-top:14px">new project</h3><div class="form"><input id="prjName" placeholder="project name (e.g. my-app)"><button class="btn" id="prjCreate">Create & Open</button></div>';
  html+='<h3 style="margin-top:14px">open existing</h3><div class="form"><input id="prjPath" placeholder="/absolute/path/to/project"><button class="btn" id="prjAdd">Add to list</button></div>';
  html+='<h3 style="margin-top:14px">free models</h3><div class="cfgrow"><span class="mut">Freebuff free models (no login). Needs Docker + the freebuff CLI run once.</span><span class="grow"></span><button class="btn" id="fbStart">Enable Freebuff</button></div>';
  html+='<h3 style="margin-top:14px">push to github</h3><div class="form"><input id="ghDesc" placeholder="one-line description"><label><input type="checkbox" id="ghPrivate"> private repo</label><button class="btn" id="ghPush">🚀 Push to GitHub</button></div>';
  body.innerHTML=html;
  body.querySelectorAll("[data-prjrm]").forEach(b=>b.onclick=async()=>{ await jpost("/api/projects/remove",{path:b.dataset.prjrm}); renderTab(); });
  body.querySelectorAll("[data-prjopen]").forEach(b=>b.onclick=()=>openProject(b.dataset.prjopen));
  const on=(id,fn)=>{const el=$(id);if(el)el.onclick=fn};
  on("prjCreate",async()=>{ const name=$("prjName").value.trim(); if(!name) return; const r=await jpost("/api/projects/create",{name}).then(x=>x.json()).catch(()=>({})); if(r.current) await afterProjectSwitch(r.current); else renderTab(); });
  on("prjAdd",async()=>{ const path=$("prjPath").value.trim(); if(!path) return; await jpost("/api/projects/add",{path}); renderTab(); });
  on("fbStart",async()=>{ addMsg("system","Enabling Freebuff (starting proxy)…"); const r=await jpost("/api/freebuff/start",{}).then(x=>x.json()).catch(()=>({ok:false,message:"failed"})); addMsg("system",(r.ok?"✓ ":"✗ ")+r.message); });
  on("ghPush",async()=>{
    const desc=$("ghDesc").value.trim(); const priv=$("ghPrivate").checked;
    addMsg("system","🚀 Pushing to GitHub… (generating README, creating repo, pushing)");
    const r=await jpost("/api/github/push",{description:desc,private:priv}).then(x=>x.json()).catch(()=>({ok:false,error:"fetch failed"}));
    if(r.ok){ addMsg("system","✓ Pushed to GitHub: "+r.repoUrl+"\nSteps: "+r.steps.join(" → ")); }
    else { addMsg("system","✗ Push failed: "+r.error); }
    renderTab();
  });
}
function loadMonaco(){ return new Promise((resolve)=>{ if(window.monaco){ resolve(); return; }
  const base="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min";
  const s=document.createElement("script"); s.src=base+"/vs/loader.min.js"; s.onload=()=>{
    window.require.config({paths:{vs:base+"/vs"}});
    window.require(["vs/editor/editor.main"],()=>resolve());
  }; document.head.appendChild(s);
});}
function edLang(path){ const e=(path.split(".").pop()||"").toLowerCase(); const m={ts:"typescript",tsx:"typescript",js:"javascript",jsx:"javascript",mjs:"javascript",cjs:"javascript",json:"json",py:"python",go:"go",rs:"rust",md:"markdown",css:"css",html:"html",sh:"shell",yml:"yaml",yaml:"yaml"}; return m[e]||"plaintext"; }
async function renderEditor(body){
  body.innerHTML='<div class="ed"><div class="edtree" id="edTree"></div><div class="edmain"><div class="edbar"><span id="edPath" class="mut">Select a file…</span><span class="grow"></span><button class="btn" id="edSave" disabled>Save</button></div><div class="edhost" id="edHost"></div></div></div>';
  if(edFiles.length===0){ const d=await jget("/api/fs/tree"); edFiles=d.files||[]; }
  $("edTree").innerHTML=edFiles.map(f=>'<div class="edfile'+(f===edCurrentFile?" on":"")+'" data-f="'+esc(f)+'">'+esc(f)+'</div>').join("")||'<div class="mut">No files.</div>';
  $("edTree").querySelectorAll("[data-f]").forEach(el=>el.onclick=()=>openInEditor(el.dataset.f));
  await loadMonaco();
  if(!monacoEditor){ monacoEditor=window.monaco.editor.create($("edHost"),{ theme:"vs-dark", automaticLayout:true, fontSize:13, minimap:{enabled:false}, value:"", language:"plaintext" }); }
  $("edSave").onclick=saveEditor;
  if(edCurrentFile) await openInEditor(edCurrentFile);
}
async function openInEditor(path){
  edCurrentFile=path; const d=await jpost("/api/fs/read",{path}).then(r=>r.json()).catch(()=>null);
  if(!d||d.error){ return; }
  if(!monacoEditor){ await loadMonaco(); monacoEditor=window.monaco.editor.create($("edHost"),{theme:"vs-dark",automaticLayout:true,fontSize:13,minimap:{enabled:false}}); }
  const model=window.monaco.editor.createModel(d.content, edLang(path));
  monacoEditor.setModel(model);
  if($("edPath")) $("edPath").textContent=path;
  if($("edSave")) $("edSave").disabled=false;
  document.querySelectorAll(".edfile").forEach(e=>e.classList.toggle("on",e.dataset.f===path));
}
async function saveEditor(){ if(!edCurrentFile||!monacoEditor) return; const content=monacoEditor.getValue();
  const r=await jpost("/api/fs/save",{path:edCurrentFile,content}).then(x=>x.json()).catch(()=>({error:"failed"}));
  const btn=$("edSave"); if(btn){ btn.textContent=r&&r.ok?"Saved ✓":"Error"; setTimeout(()=>{ if($("edSave")) $("edSave").textContent="Save"; },1500); }
}
async function cfgReload(){ if(activeTab==="config") renderTab(); await loadState(); }

// ── Autopilot (Long-Running / Full-Stack mode) ──
let autopilotTimer=null;
const APSTATUS={planning:"#f5a623",executing:"#4a9eff",verifying:"#a78bfa",fixing:"#f5a623",researching:"#22d3ee",completed:"#34d399",failed:"#ff5c5c",stalled:"#ff5c5c",paused:"#888",idle:"#888"};
async function renderAutopilot(body){
  const d=await jget("/api/autorun"); const s=d.state; const running=d.running;
  const cfg=d.config||{};
  let html='<div class="apcard"><div class="aphd"><span class="aptitle">🚀 Full-Stack Autopilot</span>'+
    '<span class="grow"></span>'+(s?'<span class="aptag" style="background:'+(APSTATUS[s.status]||"#888")+'">'+s.status+'</span>':'')+'</div>'+
    '<div class="apdesc">Toggle the 🚀 <b>Full-Stack</b> button in the header (works in any project), then send your project goal in the chat — or start one here. The AI plans a spec, splits it into phases, and works autonomously — verifying, hunting bugs (×'+(cfg.reviewPasses||3)+'), researching blockers online, and self-healing — until it ships with zero errors and no stub code.</div>';
  if(!running){
    html+='<div class="form"><textarea id="apGoal" rows="3" placeholder="e.g. Build a full-stack task manager: Express + SQLite API, React frontend, auth, tests, Docker">'+(s&&!s.finished?esc(s.goal):"")+'</textarea>'+
      '<div class="cfgrow"><button class="btn big" id="apStart">▶ Start full-stack run</button>'+
      (d.hasResumable?'<button class="btn ghost" id="apResume">⟳ Resume last run</button>':'')+'</div></div>';
  } else {
    html+='<div class="cfgrow"><button class="btn ghost" id="apStop">⏸ Pause after current step</button><span class="mut">runs autonomously — safe to leave it working</span></div>';
  }
  html+='<div class="cfgrow"><b>Swarm (parallel tasks)</b><span class="mut">run independent tasks in a phase concurrently</span><span class="grow"></span><label class="switch"><input type="checkbox" id="apSwarm" '+(cfg.parallel?"checked":"")+'><span class="track"></span></label></div>';
  html+='<div class="cfgrow"><b>Visual check URL</b><span class="mut">screenshot + vision verify (needs Playwright)</span><span class="grow"></span><input class="num" id="apPreview" style="width:200px" placeholder="http://localhost:3000" value="'+esc(cfg.previewUrl||"")+'"><button class="btn" id="apPreviewSave">Set</button></div>';
  html+='</div>';
  if(s&&s.phases&&s.phases.length){
    const done=s.phases.filter(p=>p.status==="completed").length;
    html+='<div class="bar"><i style="width:'+Math.round(done/s.phases.length*100)+'%"></i></div>';
    html+='<h3 style="margin-top:14px">phases ('+done+'/'+s.phases.length+')</h3>';
    html+=s.phases.map((p,i)=>{ const ic=p.status==="completed"?"✓":(p.status==="in_progress"||p.status==="fixing"||p.status==="verifying")?"▶":p.status==="failed"?"✗":(i+1);
      return '<div class="cfgrow"><span class="apph '+p.status+'">'+ic+'</span><b>'+esc(p.title)+'</b><span class="grow"></span><span class="mut">'+p.status+(p.reviewPasses?" · review×"+p.reviewPasses:"")+'</span></div>'; }).join("");
  }
  if(s&&s.lastError){ html+='<h3 style="margin-top:14px">last blocker</h3><pre class="diff">'+esc(s.lastError)+'</pre>'; }
  if(s&&s.events&&s.events.length){
    html+='<h3 style="margin-top:14px">activity log</h3><div class="aplog">'+s.events.slice(-60).reverse().map(e=>'<div class="apev '+e.level+'"><span class="mut">'+new Date(e.ts).toLocaleTimeString()+'</span> '+esc(e.message)+'</div>').join("")+'</div>';
  }
  body.innerHTML=html;
  const on=(id,fn)=>{ const el=$(id); if(el) el.onclick=fn; };
  on("apStart",async()=>{ const g=$("apGoal").value.trim(); if(!g){ $("apGoal").focus(); return; } await jpost("/api/autorun/start",{goal:g}); setTimeout(()=>renderTab(),400); });
  on("apResume",async()=>{ await jpost("/api/autorun/resume",{}); setTimeout(()=>renderTab(),400); });
  on("apStop",async()=>{ await jpost("/api/autorun/stop",{}); setTimeout(()=>renderTab(),400); });
  const apSwarm=$("apSwarm"); if(apSwarm) apSwarm.onchange=async()=>{ await jpost("/api/settings/autorun",{parallel:apSwarm.checked}); };
  on("apPreviewSave",async()=>{ await jpost("/api/settings/autorun",{previewUrl:$("apPreview").value.trim()}); });
  if(autopilotTimer) clearTimeout(autopilotTimer);
  if(activeTab==="autopilot"){ autopilotTimer=setTimeout(()=>{ if(activeTab==="autopilot") renderTab(); }, 3000); }
}
function wireConfig(){
  const on=(id,fn)=>{ const el=$(id); if(el) el.onclick=fn; };
  on("cfgModel",openModelModal); on("cfgChangeModel",openModelModal);
  $("tabbody").querySelectorAll("[data-conn]").forEach(b=>b.onclick=()=>{ pendingConnect=b.dataset.conn; openConnectKey(b.dataset.conn); });
  $("tabbody").querySelectorAll("[data-disc]").forEach(b=>b.onclick=async()=>{ await jpost("/api/provider/disconnect",{provider:b.dataset.disc}); cfgReload(); });
  $("tabbody").querySelectorAll("[data-steerdel]").forEach(b=>b.onclick=async()=>{ await jpost("/api/steering/delete",{name:b.dataset.steerdel}); cfgReload(); });
  $("tabbody").querySelectorAll("[data-mcpdel]").forEach(b=>b.onclick=async()=>{ await jpost("/api/mcp/delete",{name:b.dataset.mcpdel}); cfgReload(); });
  $("tabbody").querySelectorAll("[data-hookdel]").forEach(b=>b.onclick=async()=>{ await jpost("/api/hooks/delete",{file:b.dataset.hookdel}); cfgReload(); });
  $("tabbody").querySelectorAll("[data-perm]").forEach(s=>s.onchange=async()=>{ await jpost("/api/permission",{tool:s.dataset.perm,level:s.value}); });
  on("cpAdd",async()=>{ const btn=$("cpAdd"); if(btn) btn.disabled=true; try{ const res=await jpost("/api/provider/custom",{id:$("cpId").value.trim(),baseURL:$("cpUrl").value.trim(),apiKey:$("cpKey").value.trim(),model:$("cpModel").value.trim()}); const data=await res.json().catch(()=>({})); if(!res.ok){ addMsg("system","✗ Custom provider: "+(data.error||"request failed")); return; } await loadCatalog(); await cfgReload(); $("cpKey").value=""; addMsg("system","✓ Added "+data.id+" with "+data.models.length+" model(s)"+(data.warning?" · "+data.warning:"")); } finally { if(btn) btn.disabled=false; } });
  on("cpSaveComp",async()=>{ await jpost("/api/settings/compaction",{auto:$("cpAuto").checked,reserved:Number($("cpReserved").value)}); cfgReload(); });
  const auto=$("cpAuto"); if(auto) auto.onchange=async()=>{ await jpost("/api/settings/compaction",{auto:auto.checked}); };
  on("hrSave",async()=>{ await jpost("/api/settings/headroom",{enabled:$("hrEnabled").checked,reversible:$("hrReversible").checked,persist:$("hrPersist").checked,minTokens:Number($("hrMin").value)}); cfgReload(); });
  const hrEn=$("hrEnabled"); if(hrEn) hrEn.onchange=async()=>{ await jpost("/api/settings/headroom",{enabled:hrEn.checked}); cfgReload(); };
  const hrRev=$("hrReversible"); if(hrRev) hrRev.onchange=async()=>{ await jpost("/api/settings/headroom",{reversible:hrRev.checked}); };
  const hrPer=$("hrPersist"); if(hrPer) hrPer.onchange=async()=>{ await jpost("/api/settings/headroom",{persist:hrPer.checked}); cfgReload(); };
  const sd=$("specDetect"); if(sd) sd.onchange=async()=>{ await jpost("/api/settings/spec",{detect:sd.value}); };
  const sup=$("superviseToggle"); if(sup) sup.onchange=async()=>{ await jpost("/api/settings/supervise",{on:sup.checked}); cfgReload(); };
  on("stAdd",async()=>{ await jpost("/api/steering",{name:$("stName").value.trim(),content:$("stContent").value}); cfgReload(); });
  on("mcAdd",async()=>{ await jpost("/api/mcp",{name:$("mcName").value.trim(),command:$("mcCmd").value.trim(),args:$("mcArgs").value.trim()}); cfgReload(); });
  on("hkAdd",async()=>{ await jpost("/api/hooks",{name:$("hkName").value.trim(),event:$("hkEvent").value,patterns:$("hkPat").value.trim(),action:$("hkAction").value,command:$("hkCmd").value.trim(),prompt:$("hkCmd").value.trim()}); cfgReload(); });
  on("skReload",async()=>{ await jpost("/api/skills/reload",{}); cfgReload(); });
  const rtMode=$("rtMode"); if(rtMode) rtMode.onchange=()=>{ const semi=$("rtSemi"); if(semi) semi.style.display=rtMode.value==="semi"?"":"none"; const tiers=$("rtTiers"); if(tiers) tiers.style.display=rtMode.value==="tiered"?"":"none"; };
  on("rtSave",async()=>{
    const assignments={}; document.querySelectorAll(".rtAssign").forEach(s=>{ if(s.value) assignments[s.dataset.kind]=s.value; });
    const tiers={}; document.querySelectorAll(".rtTier").forEach(s=>{ if(s.value) tiers[s.dataset.tier]=s.value; });
    const fallbacks=["rtFb0","rtFb1","rtFb2"].map(id=>$(id)&&$(id).value).filter(Boolean);
    await jpost("/api/routing",{mode:$("rtMode").value,assignments,tiers,autochange:{enabled:$("rtAuto").checked,fallbacks}});
    loadRouting();
    cfgReload();
  });
  on("ghTokenSave",async()=>{ const token=$("ghToken").value.trim(); if(!token) return; const r=await jpost("/api/github/token",{token}).then(x=>x.json()).catch(()=>({error:"failed"})); if(r.ok) addMsg("system","✓ GitHub connected as "+r.username); else addMsg("system","✗ "+r.error); $("ghToken").value=""; });
}
let pendingConnect=null;
function openConnectKey(provider){
  pendingModel=null; $("modelModal").classList.add("open");
  $("modelList").innerHTML='<div style="padding:14px;color:var(--dim)">Enter the API key for <b>'+provider+'</b> below.</div>';
  $("keyRow").classList.add("open"); $("keyInput").placeholder="API key for "+provider; $("keyInput").focus();
  $("keySave").onclick=async()=>{ await jpost("/api/connect",{provider,apiKey:$("keyInput").value.trim()}); $("modelModal").classList.remove("open"); $("keyRow").classList.remove("open"); $("keyInput").value=""; $("keySave").onclick=defaultKeySave; cfgReload(); await loadCatalog(); };
}
function defaultKeySave(){ if(pendingModel) setModel(pendingModel.id,$("keyInput").value.trim()); }

function renderDiff(before,after){
  const b=(before||"").split("\n"), a=(after||"").split("\n"); let out="";
  const max=Math.max(b.length,a.length);
  for(let i=0;i<max;i++){ if(b[i]!==a[i]){ if(b[i]!==undefined&&before!==null) out+='<span class="del">- '+esc(b[i])+'</span>\n'; if(a[i]!==undefined) out+='<span class="ins">+ '+esc(a[i])+'</span>\n'; } else out+='  '+esc(a[i]??"")+'\n'; }
  return '<pre class="diff">'+out+'</pre>';
}
function esc(s){ return (s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
async function openSpec(id){ currentSpec=id; activeTab="tasks"; renderTab(); const d=await jget("/api/specs/"+id);
  if(d.tasks){ const done=d.tasks.filter(t=>t.status==="completed").length; renderPhases(Math.min(4+Math.floor((done/(d.tasks.length||1))*4),8)); } }

// ── Models ──
function renderModels(filter=""){ const list=$("modelList"); list.innerHTML=""; const f=filter.toLowerCase();
  for(const e of state.catalog){ if(f&&!e.id.toLowerCase().includes(f)) continue;
    const cls=e.free?"free":(e.connected?"ready":"key"), lbl=e.free?"free":(e.connected?"ready":"needs key");
    const row=document.createElement("div"); row.className="opt"; row.innerHTML='<span>'+e.id+'</span><span class="badge3 '+cls+'">'+lbl+'</span>';
    row.onclick=()=>chooseModel(e); list.appendChild(row); } }
function openModelModal(){ $("modelModal").classList.add("open"); renderModels(""); $("modelSearch").value=""; $("modelSearch").focus(); }
function chooseModel(e){ if(e.free||e.connected) setModel(e.id,null); else { pendingModel=e; $("keySave").onclick=defaultKeySave; $("keyRow").classList.add("open"); $("keyInput").placeholder="API key for "+e.providerId; $("keyInput").focus(); } }
async function setModel(model,apiKey){ await jpost("/api/model",{model,apiKey}); $("modelModal").classList.remove("open"); $("keyRow").classList.remove("open"); $("keyInput").value=""; pendingModel=null; await loadState(); await loadCatalog(); if(activeTab==="config") renderTab(); }

// ── Chat ──
function clearEmpty(){ const e=$("empty"); if(e) e.remove(); }
let workingEl=null;
function addMsg(role,text){ clearEmpty();
  if(role==="tool"){ updateWorking(text); return; }
  finishWorking();
  const w=document.createElement("div"); w.className="msg "+role;
  const who=role==="user"?"You":role==="assistant"?"Spectra":"system";
  w.innerHTML='<div class="who">'+(role==="assistant"?"◆ ":"")+who+'</div><div class="bubble"></div>';
  const bubble=w.querySelector(".bubble");
  if((role==="assistant"||role==="system")&&typeof marked!=="undefined"){
    try{ bubble.innerHTML=marked.parse(text,{breaks:true}); bubble.querySelectorAll("pre code").forEach(b=>{try{hljs.highlightElement(b)}catch(e){}}); }
    catch(e){ bubble.textContent=text; }
  } else { bubble.textContent=text; }
  $("chat").appendChild(w); $("chat").scrollTop=$("chat").scrollHeight; }

// ── Streaming assistant message (token by token) ──
let streamEl=null, streamBuf="";
function appendStream(delta){
  clearEmpty(); finishWorking();
  if(!streamEl){ const w=document.createElement("div"); w.className="msg assistant"; w.innerHTML='<div class="who">◆ Spectra</div><div class="bubble"></div>'; $("chat").appendChild(w); streamEl=w; streamBuf=""; }
  streamBuf+=delta;
  streamEl.querySelector(".bubble").textContent=streamBuf;
  $("chat").scrollTop=$("chat").scrollHeight;
}
function finalizeStream(fullText){
  if(!streamEl){ if(fullText) addMsg("assistant",fullText); return; }
  const bubble=streamEl.querySelector(".bubble"); const text=fullText||streamBuf;
  if(typeof marked!=="undefined"){ try{ bubble.innerHTML=marked.parse(text,{breaks:true}); bubble.querySelectorAll("pre code").forEach(b=>{try{hljs.highlightElement(b)}catch(e){}}); }catch(e){ bubble.textContent=text; } }
  else bubble.textContent=text;
  streamEl=null; streamBuf="";
}

/** Live-updating "working" card in the chat — shows the current tool step. */
function updateWorking(text){
  if(!workingEl){
    const w=document.createElement("div"); w.className="msg working";
    w.innerHTML='<div class="who"><span class="spinner"></span> Working…</div><div class="steps"></div>';
    $("chat").appendChild(w); workingEl=w;
  }
  const steps=workingEl.querySelector(".steps");
  const step=document.createElement("div"); step.className="wstep";
  step.textContent=text.replace(/^[⚙✓✗]\s?/,""); steps.appendChild(step);
  // Keep only the last 20 lines to stay compact.
  while(steps.children.length>20) steps.firstChild.remove();
  workingEl.querySelector(".who").innerHTML='<span class="spinner"></span> Working… <span class="mut">'+steps.children.length+' step(s)</span>';
  $("chat").scrollTop=$("chat").scrollHeight;
}
function finishWorking(){
  if(!workingEl) return;
  const n=workingEl.querySelector(".steps").children.length;
  workingEl.querySelector(".who").innerHTML='✓ Done <span class="mut">'+n+' step(s)</span>';
  workingEl.classList.add("done"); workingEl=null;
}

// ── Slash menu ──
function updateSlash(){ const v=$("input").value;
  if(!v.startsWith("/")||v.includes(" ")){ $("slash").classList.remove("open"); slashItems=[]; return; }
  const fw=v.split(/\s/)[0]; const seen=new Set();
  slashItems=state.commands.filter(c=>c.command.startsWith(fw)).filter(c=>!seen.has(c.command)&&seen.add(c.command));
  if(!slashItems.length){ $("slash").classList.remove("open"); return; }
  slashIndex=Math.min(slashIndex,slashItems.length-1); const el=$("slash"); el.classList.add("open");
  el.innerHTML='<div class="sh">✦ COMMANDS · ↑↓ navigate · ↵ select · esc dismiss</div>'+slashItems.map((c,i)=>'<div class="it '+(i===slashIndex?"active":"")+'" data-i="'+i+'"><code>'+c.command+'</code><span class="d">'+c.description+'</span><span class="cat">'+c.category+'</span></div>').join("");
  el.querySelectorAll(".it").forEach(it=>it.onclick=()=>{ $("input").value=slashItems[+it.dataset.i].command+" "; $("slash").classList.remove("open"); $("input").focus(); }); }
const slashOpen=()=>$("slash").classList.contains("open");

async function runSlash(text){ const cmd=text.split(/\s/)[0], arg=text.slice(cmd.length).trim();
  if(cmd==="/models"||cmd==="/model"){ if(arg){ await setModel(arg,null); } else openModelModal(); return; }
  if(cmd==="/connect"){ openModelModal(); return; }
  if(cmd==="/clear"||cmd==="/new"){ $("chat").innerHTML='<div class="empty" id="empty">New session.</div>'; await jpost("/api/clear",{}); return; }
  if(cmd==="/mode"){ if(arg) setMode(arg); else $("modeMenu").classList.toggle("open"); return; }
  if(cmd==="/specs"){ activeTab="specs"; renderTab(); return; }
  if(cmd==="/audit"||cmd==="/security"){ await setMode("security"); const goal=arg||"Audit this entire project for security vulnerabilities. Report findings by severity with file:line, the concrete risk, and a remediation. Do not change anything until I approve."; await runChat(goal,[]); return; }
  if(cmd==="/agent"){ if(arg){ await jpost("/api/agent",{agent:arg}); await loadState(); } return; }
  if(cmd==="/theme"){ if(arg&&THEMES[arg]){ applyTheme(arg); toast("Theme: "+THEMES[arg].name,"ok"); } else openThemePicker(); return; }
  addMsg("system","Run "+cmd+" from the terminal TUI for full behavior. Here, use the tabs and model picker.");
}

// ── Message queue + interrupt ──
let msgQueue=[];
let chatBusy=false;
let chatAbort=null;
// Supervised mode: tools the user chose to auto-allow for this session.
const autoAllowTools=new Set();
function handleApproval(ev){
  if(autoAllowTools.has(ev.tool)){ jpost("/api/approval",{id:ev.id,allow:true}); return; }
  clearEmpty();
  const w=document.createElement("div"); w.className="msg system";
  w.innerHTML='<div class="who">approval</div><div class="bubble">⚠ Allow <b>'+esc(ev.tool)+'</b>? <span class="mut">'+esc(ev.detail||"")+'</span>'+
    '<div class="cfgrow" style="margin-top:8px;gap:6px;flex-wrap:wrap">'+
    '<button class="btn" data-ap="allow">Allow</button>'+
    '<button class="btn ghost" data-ap="always">Always (session)</button>'+
    '<button class="btn ghost" data-ap="deny">Deny</button></div></div>';
  $("chat").appendChild(w); $("chat").scrollTop=$("chat").scrollHeight;
  const answer=(allow)=>{ w.querySelectorAll("button").forEach(b=>b.disabled=true); jpost("/api/approval",{id:ev.id,allow}); };
  w.querySelector('[data-ap="allow"]').onclick=()=>answer(true);
  w.querySelector('[data-ap="always"]').onclick=()=>{ autoAllowTools.add(ev.tool); answer(true); };
  w.querySelector('[data-ap="deny"]').onclick=()=>answer(false);
}
function renderQueue(){ const bar=$("queueBar"); if(!bar) return; if(msgQueue.length>0){ bar.className="queue-bar on"; bar.textContent="📋 "+msgQueue.length+" message(s) queued — will send when done"; } else { bar.className="queue-bar"; bar.textContent=""; } }
function showStop(show){ const s=$("stopBtn"); if(s) s.style.display=show?"inline-block":"none"; const b=$("sendBtn"); if(b) b.style.display=show?"none":"inline-block"; }

// ── Spec auto-detection (questions / auto / reject) ──
async function maybeSpec(text){
  let d; try{ d=await jpost("/api/spec/detect",{message:text}).then(r=>r.json()); }catch(e){ return false; }
  if(!d||!d.spec||d.mode==="off") return false;
  addMsg("user",text);
  if(d.mode==="auto"){ await runSpecAuto(text); return true; }
  renderSpecDecision(text); return true;
}
function renderSpecDecision(text){
  clearEmpty();
  const w=document.createElement("div"); w.className="msg system";
  w.innerHTML='<div class="who">spec</div><div class="bubble">📋 This looks like a project to build. How should I spec it?'+
    '<div class="cfgrow" style="margin-top:8px;gap:6px;flex-wrap:wrap">'+
    '<button class="btn" data-sp="questions">📋 Answer a few questions</button>'+
    '<button class="btn" data-sp="auto">🤖 Auto (Spectra decides)</button>'+
    '<button class="btn ghost" data-sp="build">✕ No, just build it</button>'+
    '</div></div>';
  $("chat").appendChild(w); $("chat").scrollTop=$("chat").scrollHeight;
  w.querySelector('[data-sp="questions"]').onclick=()=>{ w.remove(); runSpecQuestions(text); };
  w.querySelector('[data-sp="auto"]').onclick=()=>{ w.remove(); runSpecAuto(text); };
  w.querySelector('[data-sp="build"]').onclick=()=>{ w.remove(); runChat(text,[]); };
}
async function runSpecAuto(text){
  addMsg("system","🤖 Auto spec: drafting decisions…");
  const d=await jpost("/api/spec/auto-preview",{message:text}).then(x=>x.json()).catch(()=>({}));
  const clar=(d&&d.clarifications)||[]; const qs=(d&&d.questions)||[];
  if(!clar.length){
    const r=await jpost("/api/spec/generate",{message:text,clarifications:[]}).then(x=>x.json()).catch(()=>({error:"failed"}));
    if(r.specId){ addMsg("system","✓ Spec "+r.specId+" generated."); activeTab="specs"; renderTab(); } else addMsg("system","Spec error: "+(r.error||"?")); return;
  }
  renderAutoPreview(text,qs,clar);
}
function renderAutoPreview(text,qs,clar){
  clearEmpty();
  const w=document.createElement("div"); w.className="msg system";
  w.innerHTML='<div class="who">spec</div><div class="bubble"><b>🤖 Spectra chose these decisions:</b>'+
    clar.map(c=>'<div class="mut" style="margin-top:2px">• '+esc(c.question)+' → <b style="color:var(--text)">'+esc(c.answer)+'</b></div>').join("")+
    '<div class="cfgrow" style="margin-top:10px;gap:6px;flex-wrap:wrap">'+
    '<button class="btn" data-ap="gen">✓ Generate with these</button>'+
    '<button class="btn ghost" data-ap="edit">✎ Edit — answer myself</button>'+
    '<button class="btn ghost" data-ap="cancel">✕ Cancel</button></div></div>';
  $("chat").appendChild(w); $("chat").scrollTop=$("chat").scrollHeight;
  w.querySelector('[data-ap="gen"]').onclick=async()=>{ w.remove(); addMsg("system","Generating spec…"); const r=await jpost("/api/spec/generate",{message:text,clarifications:clar}).then(x=>x.json()).catch(()=>({error:"failed"})); if(r.specId){ addMsg("system","✓ Spec "+r.specId+" generated ("+r.tasks+" tasks). Open the Specs tab; use /run to execute."); activeTab="specs"; renderTab(); } else addMsg("system","Spec error: "+(r.error||"?")); };
  w.querySelector('[data-ap="edit"]').onclick=()=>{ w.remove(); if(qs.length) renderClarify(text,qs); else runSpecQuestions(text); };
  w.querySelector('[data-ap="cancel"]').onclick=()=>{ w.remove(); addMsg("system","Spec cancelled — say the word and I'll just build it."); };
}
async function runSpecQuestions(text){
  addMsg("system","Thinking of a few clarifying questions…");
  const d=await jpost("/api/spec/clarify",{message:text}).then(x=>x.json()).catch(()=>({questions:[]}));
  const qs=(d&&d.questions)||[];
  if(!qs.length){ const r=await jpost("/api/spec/generate",{message:text,clarifications:[]}).then(x=>x.json()).catch(()=>({error:"failed"})); if(r.specId){ addMsg("system","✓ Spec "+r.specId+" generated."); activeTab="specs"; renderTab(); } else addMsg("system","Spec error: "+(r.error||"no questions")); return; }
  renderClarify(text,qs);
}
function renderClarify(text,qs){
  clearEmpty();
  const answers=new Array(qs.length).fill("");
  const w=document.createElement("div"); w.className="msg system";
  let html='<div class="who">spec</div><div class="bubble"><b>Answer these to shape the spec</b><div class="mut">pick an option or write your own</div>';
  qs.forEach((q,i)=>{
    html+='<div class="cfgsec" style="margin-top:8px"><div style="margin-bottom:4px">'+(i+1)+'. '+esc(q.question)+'</div><div class="cfgrow" style="gap:6px;flex-wrap:wrap" data-q="'+i+'">'+
      (q.options||[]).map((o,j)=>'<button class="btn ghost" data-opt="'+i+'_'+j+'">'+esc(o)+'</button>').join("")+
      '</div><input class="num" style="width:100%;margin-top:4px" placeholder="…or write your own answer" data-free="'+i+'"></div>';
  });
  html+='<div class="cfgrow" style="margin-top:10px"><button class="btn" id="specGo">Generate spec</button><span class="grow"></span><button class="btn ghost" id="specCancel">Cancel</button></div></div>';
  w.innerHTML=html; $("chat").appendChild(w); $("chat").scrollTop=$("chat").scrollHeight;
  qs.forEach((q,i)=>{
    (q.options||[]).forEach((o,j)=>{ const b=w.querySelector('[data-opt="'+i+'_'+j+'"]'); b.onclick=()=>{ answers[i]=o; w.querySelectorAll('[data-q="'+i+'"] .btn').forEach(x=>x.classList.add("ghost")); b.classList.remove("ghost"); const fi=w.querySelector('[data-free="'+i+'"]'); if(fi) fi.value=""; }; });
    const fi=w.querySelector('[data-free="'+i+'"]'); fi.oninput=()=>{ if(fi.value.trim()){ answers[i]=fi.value.trim(); w.querySelectorAll('[data-q="'+i+'"] .btn').forEach(x=>x.classList.add("ghost")); } };
  });
  w.querySelector("#specCancel").onclick=()=>{ w.remove(); addMsg("system","Spec cancelled — say the word and I'll just build it."); };
  w.querySelector("#specGo").onclick=async()=>{
    const clar=qs.map((q,i)=>({question:q.question,answer:answers[i]||(q.options&&q.options[0])||""}));
    w.remove(); addMsg("system","Generating spec from your answers…");
    const r=await jpost("/api/spec/generate",{message:text,clarifications:clar}).then(x=>x.json()).catch(()=>({error:"failed"}));
    if(r.error){ addMsg("system","Spec error: "+r.error); return; }
    addMsg("system","✓ Spec "+r.specId+" generated ("+r.tasks+" tasks). Open the Specs tab; use /run to execute.");
    activeTab="specs"; renderTab();
  };
}

async function send(){ const ta=$("input"); const text=ta.value.trim(); if(!text&&pendingImages.length===0) return; ta.value=""; updateSlash(); ta.style.height="auto";
  if(text.startsWith("/")){ await runSlash(text); return; }
  if(autopilotMode){ await launchAutopilot(text); return; }
  if(pendingImages.length===0 && !chatBusy){ if(await maybeSpec(text)) return; }
  const imgs=pendingImages.slice(); pendingImages=[]; renderPendingImages();
  if(chatBusy){ msgQueue.push({text,imgs}); renderQueue(); addMsg("system","📋 Queued: \""+text.slice(0,60)+(text.length>60?"…":"")+"\""); return; }
  await runChat(text,imgs);
  while(msgQueue.length>0){ const next=msgQueue.shift(); renderQueue(); addMsg("system","📋 Sending queued: \""+next.text.slice(0,60)+"\""); await runChat(next.text,next.imgs); }
}
async function runChat(text,imgs){
  chatBusy=true; showStop(true); chatAbort=new AbortController();
  addMsg("user",text+(imgs.length?"  📎 "+imgs.length+" image(s)":"")); stats.think++; refreshStats();
  try{
    const res=await jpost("/api/chat",{message:text,images:imgs.length?imgs:undefined});
    const reader=res.body.getReader(); const dec=new TextDecoder(); let buf="";
    while(true){ if(chatAbort.signal.aborted){ reader.cancel(); break; }
      const {done,value}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true});
      const parts=buf.split("\n\n"); buf=parts.pop()||"";
      for(const p of parts){ if(!p.startsWith("data:")) continue;
        try{ const ev=JSON.parse(p.slice(5).trim());
          if(ev.type==="chunk"){ appendStream(ev.text); }
          else if(ev.type==="text"){ finishWorking(); finalizeStream(ev.text); stats.think=Math.max(0,stats.think-1); stats.done++; refreshStats(); }
          else if(ev.type==="tool"){ finalizeStream(); addMsg("tool",ev.text); stats.exec++; refreshStats(); if(activeTab==="logs"||activeTab==="files"||activeTab==="diff") renderTab(); }
          else if(ev.type==="usage"){ stats.in+=ev.in||0; stats.out+=ev.out||0; stats.exec=0; refreshStats(); }
          else if(ev.type==="approval"){ handleApproval(ev); }
          else if(ev.type==="error"){ finishWorking(); finalizeStream(); addMsg("system",ev.text); stats.err++; refreshStats(); }
        }catch(e){} } }
  }catch(e){ if(!chatAbort.signal.aborted) addMsg("system","Error: "+(e.message||e)); }
  finishWorking(); chatBusy=false; chatAbort=null; showStop(false);
  await loadState(); if(activeTab!=="activity") renderTab();
  // Desktop notification when a long task finishes.
  if(document.hidden&&typeof Notification!=="undefined"&&Notification.permission==="granted") new Notification("Spectra",{body:"Task complete.",icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect fill='%239333ea'/></svg>"});
}
function interruptChat(){ if(chatAbort){ chatAbort.abort(); finishWorking(); addMsg("system","⏹ Interrupted."); msgQueue=[]; renderQueue(); chatBusy=false; showStop(false); } }

// ── Full-Stack Autopilot toggle ──
function setAutopilotUI(){
  const btn=$("autopilotBtn"); if(btn) btn.classList.toggle("apon",autopilotMode);
  const ta=$("input"); if(!ta) return;
  ta.placeholder=autopilotMode
    ? "🚀 Full-Stack ON — describe the COMPLETE project to build autonomously, then press ↵"
    : "Message Spectra…  ·  / commands  ·  @ files  ·  ! shell";
}
async function toggleAutopilot(){
  const d=await jget("/api/autorun");
  if(d.running){ showAutopilotStatus(d.state); return; }
  autopilotMode=!autopilotMode; setAutopilotUI();
  if(autopilotMode){
    addMsg("system","🚀 Full-Stack Autopilot ARMED. Your next message is the project goal — I'll plan, build, verify and self-heal until complete. Toggle again to disarm.");
    $("input").focus();
  } else {
    addMsg("system","Full-Stack Autopilot disarmed.");
  }
}
function showAutopilotStatus(s){
  if(!s) return;
  const done=s.phases?s.phases.filter(p=>p.status==="completed").length:0;
  const total=s.phases?s.phases.length:0;
  const lines=["🚀 Autopilot: "+s.status+" ("+done+"/"+total+" phases)"];
  if(s.phases) s.phases.forEach((p,i)=>lines.push("  "+(p.status==="completed"?"✓":p.status==="in_progress"||p.status==="fixing"?"▶":"·")+" "+p.title));
  if(s.lastError) lines.push("  ⚠ "+s.lastError.slice(0,120));
  addMsg("system",lines.join("\n"));
}
async function launchAutopilot(goal){
  addMsg("user",goal);
  const r=await jpost("/api/autorun/start",{goal});
  const d=await r.json().catch(()=>({}));
  autopilotMode=false; setAutopilotUI();
  if(d&&d.error){ addMsg("system","Autopilot: "+d.error); return; }
  addMsg("system","🚀 Autopilot started. It runs autonomously — open the 🚀 Autopilot tab to watch phases, verification and self-healing live. Safe to leave it working.");
  activeTab="autopilot"; renderTab();
}

// ── Usage (token chart from real Headroom + cost data) ──
function fmtTok(n){ n=n||0; if(n>=1e6) return (n/1e6).toFixed(1)+"M"; if(n>=1e3) return (n/1e3).toFixed(1)+"k"; return ""+n; }
async function renderUsage(body){
  const hr=await jget("/api/headroom"); const cost=await jget("/api/cost");
  const s=(hr&&hr.stats)||{originalTokens:0,compressedTokens:0,payloads:0,compressedPayloads:0,stored:0};
  const orig=s.originalTokens||0, comp=s.compressedTokens||0; const saved=Math.max(0,orig-comp);
  const pct=orig>0?Math.round(saved/orig*100):0;
  const inTok=(cost&&cost.inputTokens)||0, outTok=(cost&&cost.outputTokens)||0, usd=(cost&&cost.usd)||0;
  const enabled=hr&&hr.config&&hr.config.enabled;
  const C=2*Math.PI*42; const dash=(pct/100)*C;
  let html='<h3>token usage</h3><div class="ucards">'+
    '<div class="ucard"><div class="n">'+fmtTok(inTok)+'</div><div class="l">input tokens</div></div>'+
    '<div class="ucard"><div class="n">'+fmtTok(outTok)+'</div><div class="l">output tokens</div></div>'+
    '<div class="ucard"><div class="n">~$'+usd.toFixed(3)+'</div><div class="l">est. cost</div></div></div>';
  html+='<h3 style="margin-top:16px">Headroom compression '+(enabled?'<span class="sev ok">on</span>':'<span class="sev warn">off</span>')+'</h3>';
  if(orig>0){
    html+='<div class="donut-wrap"><svg class="donut" width="108" height="108" viewBox="0 0 104 104">'+
      '<circle cx="52" cy="52" r="42" fill="none" stroke="var(--border)" stroke-width="10"></circle>'+
      '<circle cx="52" cy="52" r="42" fill="none" stroke="var(--emerald)" stroke-width="10" stroke-linecap="round" stroke-dasharray="'+dash.toFixed(1)+' '+C.toFixed(1)+'" transform="rotate(-90 52 52)"></circle>'+
      '<text x="52" y="50" text-anchor="middle" fill="var(--text)" font-size="20" font-weight="700">'+pct+'%</text>'+
      '<text x="52" y="66" text-anchor="middle" fill="var(--dim)" font-size="9">saved</text></svg>'+
      '<div class="ulegend">'+
      '<div class="lr"><span class="sw" style="background:var(--border)"></span><span><b>'+fmtTok(orig)+'</b> <span class="mut">original tokens</span></span></div>'+
      '<div class="lr"><span class="sw" style="background:var(--emerald)"></span><span><b>'+fmtTok(saved)+'</b> <span class="mut">tokens saved</span></span></div>'+
      '<div class="lr"><span class="sw" style="background:var(--primary)"></span><span><b>'+fmtTok(comp)+'</b> <span class="mut">tokens actually sent</span></span></div>'+
      '<div class="lr"><span class="mut">'+(s.compressedPayloads||0)+' / '+(s.payloads||0)+' payloads compressed · '+(s.stored||0)+' originals stored</span></div>'+
      '</div></div>';
  } else {
    html+='<div class="empty">No payloads processed yet. Headroom compresses large tool outputs and context as you work — the savings show up here live.</div>';
  }
  body.innerHTML=html;
}

// ── Problems (real project verification) ──
let lastProblems=null;
async function renderProblems(body){
  body.innerHTML='<div class="pbhd"><h3 style="margin:0">problems</h3><span class="grow"></span><button class="btn" id="pbRun">▶ Run verification</button></div>'+
    (lastProblems?renderProblemsList(lastProblems):'<div class="empty">Runs the project build, tests and lint, then scans for stubs and structural issues. Click ▶ to start.</div>');
  const btn=$("pbRun"); if(btn) btn.onclick=async()=>{
    btn.disabled=true; btn.textContent="Running…"; toast("Running verification…");
    const r=await jpost("/api/verify",{}).then(x=>x.json()).catch(()=>({error:"request failed"}));
    if(r.error){ toast("Verification error: "+r.error,"err"); btn.disabled=false; btn.textContent="▶ Run verification"; return; }
    lastProblems=r;
    toast(r.ok?"✓ No problems found":r.problems+" problem(s) found",r.ok?"ok":"warn");
    if(activeTab==="problems") renderProblems(body);
  };
}
function renderProblemsList(r){
  const cmds=r.verify||[], struct=r.structural||[], sk=r.skeletons||[];
  let html='<div style="margin-bottom:8px">'+(r.ok?'<span class="sev ok">all clear</span>':'<span class="sev err">'+r.problems+' problem(s)</span>')+' <span class="mut">'+(r.commands||[]).length+' command(s) detected</span></div>';
  if(!cmds.length&&!struct.length&&!sk.length) return html+'<div class="empty">No issues found.</div>';
  cmds.forEach(c=>{ html+='<div class="pb"><div class="pbt"><span class="sev '+(c.ok?"ok":"err")+'">'+(c.ok?"pass":"fail")+'</span><b>'+esc(c.command)+'</b><span class="grow"></span><span class="mut">'+(Math.round((c.durationMs||0)/100)/10)+'s</span></div>'+(c.ok?'':'<pre class="diff">'+esc((c.output||"").slice(-1400))+'</pre>')+'</div>'; });
  struct.forEach(s=>{ html+='<div class="pb"><div class="pbt"><span class="sev '+(s.blocking?"err":"warn")+'">'+(s.blocking?"structural":"advice")+'</span><span class="pbloc">'+esc(s.kind)+'</span></div><div class="mut" style="margin-top:4px">'+esc(s.detail)+'</div></div>'; });
  if(sk.length){ html+='<div class="pb"><div class="pbt"><span class="sev warn">stubs</span><b>'+sk.length+' placeholder marker(s)</b></div><pre class="diff">'+esc(sk.slice(0,40).map(v=>v.file+":"+v.line+"  "+v.text).join("\n"))+'</pre></div>'; }
  return html;
}

// ── Themes ──
const THEMES={
 midnight:{name:"Midnight",vars:{bg:"oklch(0.13 0.015 280)",panel:"oklch(0.17 0.018 280)",panel2:"oklch(0.21 0.020 280)",border:"oklch(0.28 0.018 280)","border-strong":"oklch(0.36 0.024 280)",primary:"oklch(0.65 0.22 295)","primary-soft":"oklch(0.65 0.22 295 / 0.15)",accent:"oklch(0.78 0.15 200)","accent-soft":"oklch(0.78 0.15 200 / 0.15)",emerald:"oklch(0.72 0.17 155)","emerald-soft":"oklch(0.72 0.17 155 / 0.15)",rose:"oklch(0.68 0.22 18)","rose-soft":"oklch(0.68 0.22 18 / 0.15)",text:"oklch(0.96 0.005 280)",dim:"oklch(0.70 0.012 280)",faint:"oklch(0.48 0.012 280)"}},
 light:{name:"Light",vars:{bg:"oklch(0.97 0.004 280)",panel:"oklch(0.995 0.002 280)",panel2:"oklch(0.945 0.005 280)",border:"oklch(0.88 0.008 280)","border-strong":"oklch(0.77 0.012 280)",primary:"oklch(0.53 0.22 295)","primary-soft":"oklch(0.53 0.22 295 / 0.13)",accent:"oklch(0.55 0.13 200)","accent-soft":"oklch(0.55 0.13 200 / 0.13)",emerald:"oklch(0.55 0.15 155)","emerald-soft":"oklch(0.55 0.15 155 / 0.13)",rose:"oklch(0.55 0.2 18)","rose-soft":"oklch(0.55 0.2 18 / 0.13)",text:"oklch(0.22 0.02 280)",dim:"oklch(0.45 0.02 280)",faint:"oklch(0.62 0.015 280)"}},
 nord:{name:"Nord",vars:{bg:"#2e3440",panel:"#343c4a",panel2:"#3b4252",border:"#434c5e","border-strong":"#4c566a",primary:"#88c0d0","primary-soft":"rgba(136,192,208,.15)",accent:"#81a1c1","accent-soft":"rgba(129,161,193,.15)",emerald:"#a3be8c","emerald-soft":"rgba(163,190,140,.15)",rose:"#bf616a","rose-soft":"rgba(191,97,106,.15)",text:"#eceff4",dim:"#d8dee9",faint:"#7b88a1"}},
 solarized:{name:"Solarized Dark",vars:{bg:"#002b36",panel:"#073642",panel2:"#0a4856",border:"#0f5666","border-strong":"#147084",primary:"#268bd2","primary-soft":"rgba(38,139,210,.16)",accent:"#2aa198","accent-soft":"rgba(42,161,152,.16)",emerald:"#859900","emerald-soft":"rgba(133,153,0,.16)",rose:"#dc322f","rose-soft":"rgba(220,50,47,.16)",text:"#93a1a1",dim:"#839496",faint:"#586e75"}}
};
let currentTheme="midnight";
function applyTheme(id){ const t=THEMES[id]||THEMES.midnight; const r=document.documentElement; for(const k in t.vars) r.style.setProperty("--"+k,t.vars[k]); currentTheme=THEMES[id]?id:"midnight"; try{localStorage.setItem("spectra-theme",currentTheme);}catch(e){} }
function openThemePicker(){
  const list=$("themeList");
  list.innerHTML=Object.keys(THEMES).map(id=>{ const t=THEMES[id]; return '<div class="opt theme-opt'+(id===currentTheme?" active":"")+'" data-th="'+id+'"><span class="tt">'+t.name+(id===currentTheme?'  ✓':'')+'</span><span class="swatches"><i style="background:'+t.vars.primary+'"></i><i style="background:'+t.vars.accent+'"></i><i style="background:'+t.vars.emerald+'"></i><i style="background:'+t.vars.bg+'"></i></span></div>'; }).join("");
  list.querySelectorAll("[data-th]").forEach(el=>el.onclick=()=>{ applyTheme(el.dataset.th); toast("Theme: "+THEMES[el.dataset.th].name,"ok"); openThemePicker(); });
  $("themeModal").classList.add("open");
}

// ── Toasts ──
function toast(msg,kind){ const c=$("toasts"); if(!c) return; const t=document.createElement("div"); t.className="toast "+(kind||""); t.innerHTML='<span class="tt">'+esc(msg)+'</span>'; c.appendChild(t); setTimeout(()=>{ t.style.transition="opacity .25s, transform .25s"; t.style.opacity="0"; t.style.transform="translateY(6px)"; setTimeout(()=>t.remove(),260); }, kind==="err"?5200:3000); }

// ── Command palette (Ctrl/Cmd+K) ──
let palItems=[], palIndex=0;
function paletteActions(){
  const go=(t)=>()=>{ closePalette(); activeTab=t; renderTab(); };
  return [
    {icon:"◆",label:"Go to Specs",cat:"go",run:go("specs")},
    {icon:"☰",label:"Go to Tasks",cat:"go",run:go("tasks")},
    {icon:"🗂",label:"Go to Files",cat:"go",run:go("files")},
    {icon:"📜",label:"Go to Logs",cat:"go",run:go("logs")},
    {icon:"📊",label:"Go to Activity",cat:"go",run:go("activity")},
    {icon:"⚙",label:"Go to Config",cat:"go",run:go("config")},
    {icon:"⚠",label:"Go to Problems",cat:"go",run:go("problems")},
    {icon:"📈",label:"Go to Usage",cat:"go",run:go("usage")},
    {icon:"🚀",label:"Go to Autopilot",cat:"go",run:go("autopilot")},
    {icon:"●",label:"Change model…",cat:"action",run:()=>{ closePalette(); openModelModal(); }},
    {icon:"🚀",label:"Toggle Full-Stack Autopilot",cat:"action",run:()=>{ closePalette(); toggleAutopilot(); }},
    {icon:"⬆",label:"Push to GitHub",cat:"action",run:()=>{ closePalette(); openGithub(); }},
    {icon:"🔍",label:"Search chat",cat:"action",run:()=>{ closePalette(); $("searchBar").classList.add("on"); $("searchInput").focus(); }},
    {icon:"🎨",label:"Change theme…",cat:"action",run:()=>{ closePalette(); openThemePicker(); }},
    {icon:"⌨",label:"Keyboard shortcuts",cat:"action",run:()=>{ closePalette(); toggleShortcuts(true); }},
    {icon:"✦",label:"New session",cat:"action",run:()=>{ closePalette(); runSlash("/clear"); toast("Started a new session","ok"); }},
  ];
}
function buildPalette(filter){
  const f=(filter||"").toLowerCase().trim();
  const acts=paletteActions().map(a=>Object.assign({type:"action"},a));
  const cmds=(state.commands||[]).map(c=>({type:"cmd",icon:"/",label:c.command,desc:c.description,cat:c.category,args:c.args,run:()=>{ closePalette(); $("input").value=c.command+(c.args?" ":""); $("input").focus(); if(!c.args) send(); }}));
  let all=acts.concat(cmds);
  if(f) all=all.filter(x=>(x.label+" "+(x.desc||"")+" "+(x.cat||"")).toLowerCase().includes(f));
  return all.slice(0,60);
}
function renderPalette(){
  const list=$("palList"); palItems=buildPalette($("palInput").value);
  if(palIndex>=palItems.length) palIndex=Math.max(0,palItems.length-1);
  list.innerHTML=palItems.map((x,i)=>'<div class="palit '+(i===palIndex?"active":"")+'" data-i="'+i+'"><span class="pi">'+x.icon+'</span>'+(x.type==="cmd"?'<code>'+esc(x.label)+'</code>':'<span class="tt">'+esc(x.label)+'</span>')+'<span class="pd">'+esc(x.desc||"")+'</span><span class="pcat">'+esc(x.cat||"")+'</span></div>').join("")||'<div class="palsec">No matches</div>';
  list.querySelectorAll(".palit").forEach(el=>{ el.onclick=()=>{ palIndex=+el.dataset.i; runPalette(); }; el.onmouseenter=()=>{ palIndex=+el.dataset.i; list.querySelectorAll(".palit").forEach(n=>n.classList.toggle("active",n===el)); }; });
}
function openPalette(){ $("paletteModal").classList.add("open"); $("palInput").value=""; palIndex=0; renderPalette(); setTimeout(()=>$("palInput").focus(),0); }
function closePalette(){ $("paletteModal").classList.remove("open"); }
function paletteOpen(){ return $("paletteModal").classList.contains("open"); }
function runPalette(){ const it=palItems[palIndex]; if(it) it.run(); }
function toggleShortcuts(show){ const el=$("shortcutsOverlay"); el.classList.toggle("open", show===undefined?!el.classList.contains("open"):!!show); }

// Wiring
const ta=$("input");
ta.addEventListener("input",()=>{ ta.style.height="auto"; ta.style.height=Math.min(ta.scrollHeight,160)+"px"; updateSlash(); });
ta.addEventListener("keydown",(e)=>{ if(slashOpen()){
   if(e.key==="ArrowDown"){ e.preventDefault(); slashIndex=Math.min(slashIndex+1,slashItems.length-1); updateSlash(); return; }
   if(e.key==="ArrowUp"){ e.preventDefault(); slashIndex=Math.max(slashIndex-1,0); updateSlash(); return; }
   if(e.key==="Tab"||(e.key==="Enter"&&slashItems[slashIndex])){ e.preventDefault(); ta.value=slashItems[slashIndex].command+" "; $("slash").classList.remove("open"); return; }
   if(e.key==="Escape"){ $("slash").classList.remove("open"); return; } }
  if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); } });
$("sendBtn").onclick=send;
$("stopBtn").onclick=interruptChat;
document.addEventListener("keydown",(e)=>{ if((e.ctrlKey||e.metaKey)&&e.key==="f"){ e.preventDefault(); $("searchBar").classList.add("on"); $("searchInput").focus(); } });
$("searchClose").onclick=()=>{ $("searchBar").classList.remove("on"); $("searchInput").value=""; document.querySelectorAll(".msg.search-hide").forEach(m=>m.classList.remove("search-hide")); };
$("searchInput").addEventListener("input",(e)=>{ const q=e.target.value.toLowerCase(); document.querySelectorAll(".msg").forEach(m=>{ const has=m.textContent.toLowerCase().includes(q)||!q; m.classList.toggle("search-hide",!has); }); });
ta.addEventListener("paste",(e)=>{ const items=(e.clipboardData&&e.clipboardData.files)||[]; if(items.length){ const imgs=[...items].filter(f=>f.type.startsWith("image/")); if(imgs.length){ e.preventDefault(); addImageFiles(imgs); } } });
ta.addEventListener("dragover",(e)=>{ e.preventDefault(); });
ta.addEventListener("drop",(e)=>{ if(e.dataTransfer&&e.dataTransfer.files.length){ e.preventDefault(); addImageFiles([...e.dataTransfer.files]); } });
$("modelPill").onclick=openModelModal; $("connectBtn").onclick=openModelModal;
$("autopilotBtn").onclick=toggleAutopilot;
$("githubBtn").onclick=openGithub;
async function openGithub(){
  const g=await jget("/api/github");
  if(!g||!g.configured){ addMsg("system","Connect GitHub first: paste a token in Config → GitHub (PAT with repo scope)."); activeTab="config"; renderTab(); setTimeout(()=>{ const el=$("ghToken"); if(el) el.scrollIntoView({behavior:"smooth",block:"center"}); },150); return; }
  $("ghModal").classList.add("open"); const di=$("ghDesc2"); if(di) di.focus();
}
$("ghModal").onclick=(e)=>{ if(e.target===$("ghModal")) $("ghModal").classList.remove("open"); };
$("ghPushBtn").onclick=async()=>{
  const desc=$("ghDesc2").value.trim(); const priv=$("ghPrivate2").checked;
  $("ghModal").classList.remove("open");
  addMsg("system","🚀 Pushing to GitHub… (generating README, creating repo, pushing)");
  const r=await jpost("/api/github/push",{description:desc,private:priv}).then(x=>x.json()).catch(()=>({ok:false,error:"request failed"}));
  if(r.ok){ addMsg("system","✓ Pushed to GitHub: "+r.repoUrl+"\nSteps: "+(r.steps||[]).join(" → ")); }
  else { addMsg("system","✗ Push failed: "+r.error); }
};
$("paletteBtn").onclick=openPalette;
$("palInput").addEventListener("input",renderPalette);
$("palInput").addEventListener("keydown",(e)=>{
  if(e.key==="ArrowDown"){ e.preventDefault(); palIndex=Math.min(palIndex+1,palItems.length-1); renderPalette(); }
  else if(e.key==="ArrowUp"){ e.preventDefault(); palIndex=Math.max(palIndex-1,0); renderPalette(); }
  else if(e.key==="Enter"){ e.preventDefault(); runPalette(); }
  else if(e.key==="Escape"){ e.preventDefault(); closePalette(); }
});
$("paletteModal").onclick=(e)=>{ if(e.target===$("paletteModal")) closePalette(); };
$("themeModal").onclick=(e)=>{ if(e.target===$("themeModal")) $("themeModal").classList.remove("open"); };
try{ applyTheme(localStorage.getItem("spectra-theme")||"midnight"); }catch(e){}
$("shortcutsOverlay").onclick=()=>toggleShortcuts(false);
document.addEventListener("keydown",(e)=>{
  if((e.ctrlKey||e.metaKey)&&(e.key==="k"||e.key==="K")){ e.preventDefault(); paletteOpen()?closePalette():openPalette(); return; }
  if((e.ctrlKey||e.metaKey)&&(e.key==="n"||e.key==="N")){ e.preventDefault(); runSlash("/clear"); toast("Started a new session","ok"); return; }
  const typing=/^(INPUT|TEXTAREA)$/.test((e.target&&e.target.tagName)||"");
  if(e.key==="?"&&!typing){ e.preventDefault(); toggleShortcuts(); return; }
  if(e.key==="Escape"){ if($("themeModal").classList.contains("open")){ $("themeModal").classList.remove("open"); return; } if($("shortcutsOverlay").classList.contains("open")){ toggleShortcuts(false); return; } if(paletteOpen()){ closePalette(); return; } if(chatBusy&&!slashOpen()){ interruptChat(); } }
});
$("modePill").onclick=(e)=>{ if(e.target.closest(".menu")) return; $("modeMenu").classList.toggle("open"); };
document.addEventListener("click",(e)=>{ if(!e.target.closest("#modePill")) $("modeMenu").classList.remove("open"); });
$("routePill").onclick=(e)=>{ if(e.target.closest(".menu")) return; $("routeMenu").classList.toggle("open"); };
document.addEventListener("click",(e)=>{ if(!e.target.closest("#routePill")) $("routeMenu").classList.remove("open"); });
document.addEventListener("click",(e)=>{ if(!e.target.closest(".tabmore")){ const m=$("tabMoreMenu"); if(m) m.classList.remove("open"); } });
$("modelModal").onclick=(e)=>{ if(e.target===$("modelModal")) $("modelModal").classList.remove("open"); };
$("modelSearch").addEventListener("input",(e)=>renderModels(e.target.value));
$("keySave").onclick=defaultKeySave;

renderModeMenu(); renderPhases(1); renderTabs({}); renderTab();
if(typeof Notification!=="undefined"&&Notification.permission==="default") Notification.requestPermission();
loadState().then(loadCommands).then(loadCatalog).then(loadRouting).then(loadHistory).then(()=>renderTab());
setInterval(pollAutopilotBadge, 4000); pollAutopilotBadge();
async function pollAutopilotBadge(){
  try{
    const c=await jget("/api/cost"); const sb=$("sbTok"); if(sb&&c&&typeof c.usd==="number"){ sb.textContent=stats.in+"↑ "+stats.out+"↓  ~$"+c.usd.toFixed(3); }
    const d=await jget("/api/autorun"); const btn=$("autopilotBtn"); const lbl=$("autopilotLbl"); if(!btn||!lbl) return;
    if(d.running){ const ph=d.state&&d.state.phases?d.state.phases.filter(p=>p.status==="completed").length:0; const tot=d.state&&d.state.phases?d.state.phases.length:0;
      btn.classList.add("aprun"); btn.classList.remove("apon"); lbl.textContent="Autopilot "+(tot?ph+"/"+tot:"running")+" ⏵"; autopilotMode=false; setAutopilotUI();
    } else { btn.classList.remove("aprun"); lbl.textContent=autopilotMode?"Full-Stack ARMED":"Full-Stack"; }
  }catch(e){}
}
</script>
</body>
</html>`
