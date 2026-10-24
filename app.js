/* Prompteur — appli web installable (PWA) pour concerts, mariages et lives.
   Les données sont stockées sur l'appareil (fonctionne hors ligne) et synchronisées
   avec Supabase quand l'utilisateur est connecté. */
(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  }));
const nowIso = () => new Date().toISOString();
const ts = (iso) => Date.parse(iso) || 0;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ================= STOCKAGE LOCAL ================= */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const db = {
  textes: store.get('pr_textes', {}),
  setlists: store.get('pr_setlists', {}),
  save() { store.set('pr_textes', this.textes); store.set('pr_setlists', this.setlists); }
};

function randomCode() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

const defaults = {
  font: window.innerWidth < 500 ? 48 : 72,
  speed: 15, lh: 1.35, margin: 6, guide: 30, count: 3,
  align: 'left', theme: 'dark', mirror: false, flip: false, upper: false,
  showguide: true, autonext: false, code: randomCode()
};
const prefs = Object.assign({}, defaults, store.get('pr_prefs', {}));
store.set('pr_prefs', prefs);
const savePrefs = () => store.set('pr_prefs', prefs);

const liveTextes = () => Object.values(db.textes).filter(t => !t.supprime);
const liveSetlists = () => Object.values(db.setlists).filter(s => !s.supprime);

function touchTexte(t) { t.updated_at = nowIso(); t._dirty = true; db.save(); scheduleSync(); }
function touchSetlist(s) { s.updated_at = nowIso(); s._dirty = true; db.save(); scheduleSync(); }

/* ================= UI GÉNÉRALE ================= */
let toastTimer;
function toast(msg, ms = 2200) {
  const el = $('#toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

const stack = [];
function show(id, push = true) {
  const cur = $$('.view').find(v => !v.classList.contains('hidden'));
  if (push && cur && cur.id !== id) stack.push(cur.id);
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== id));
}
function back() {
  const id = stack.pop() || 'v-home';
  show(id, false);
  if (id === 'v-home') renderHome();
  if (id === 'v-setlist') renderSetlist();
}
$$('[data-back]').forEach(b => b.addEventListener('click', () => { onLeaveView(); back(); }));

function onLeaveView() {
  if (!$('#v-edit').classList.contains('hidden')) flushEdit();
  if (!$('#v-remote').classList.contains('hidden')) rcLeave();
}

/* ================= ACCUEIL ================= */
let currentTab = 'textes';
$$('.tab').forEach(b => b.addEventListener('click', () => {
  currentTab = b.dataset.tab;
  $$('.tab').forEach(x => x.classList.toggle('active', x === b));
  $('#tab-textes').classList.toggle('hidden', currentTab !== 'textes');
  $('#tab-setlists').classList.toggle('hidden', currentTab !== 'setlists');
}));
$('#search').addEventListener('input', renderHome);

function firstLine(s) {
  return (s || '').split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) || '';
}

function renderHome() {
  const q = $('#search').value.trim().toLowerCase();
  const textes = liveTextes()
    .filter(t => !q || (t.titre + ' ' + t.contenu).toLowerCase().includes(q))
    .sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
  const ul = $('#list-textes'); ul.innerHTML = '';
  for (const t of textes) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div>
      <button class="li-play" aria-label="Lancer">▶</button>`;
    li.querySelector('.li-title').textContent = t.titre || 'Sans titre';
    li.querySelector('.li-sub').textContent = firstLine(t.contenu) || 'Vide';
    li.querySelector('.li-main').onclick = () => openEdit(t.id);
    li.querySelector('.li-play').onclick = () => startPrompter([t.id], 0);
    ul.appendChild(li);
  }
  $('#empty-textes').classList.toggle('hidden', textes.length > 0 || !!q);

  const sls = liveSetlists().sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
  const ul2 = $('#list-setlists'); ul2.innerHTML = '';
  for (const s of sls) {
    const ids = s.texte_ids.filter(id => db.textes[id] && !db.textes[id].supprime);
    const li = document.createElement('li');
    li.innerHTML = `<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div>
      <button class="li-play" aria-label="Lancer">▶</button>`;
    li.querySelector('.li-title').textContent = s.nom || 'Setlist sans nom';
    li.querySelector('.li-sub').textContent = `${ids.length} morceau${ids.length > 1 ? 'x' : ''} · ` +
      ids.map(id => db.textes[id].titre || 'Sans titre').join(', ');
    li.querySelector('.li-main').onclick = () => openSetlist(s.id);
    li.querySelector('.li-play').onclick = () => ids.length ? startPrompter(ids, 0) : toast('Setlist vide');
    ul2.appendChild(li);
  }
  $('#empty-setlists').classList.toggle('hidden', sls.length > 0);
}

$('#fab').addEventListener('click', () => {
  if (currentTab === 'textes') openEdit(null);
  else {
    const s = { id: uuid(), nom: '', texte_ids: [], supprime: false, created_at: nowIso() };
    db.setlists[s.id] = s; touchSetlist(s); openSetlist(s.id);
  }
});

/* ================= ÉDITEUR DE TEXTE ================= */
let editId = null, editTimer = null;
function openEdit(id) {
  editId = id;
  const t = id ? db.textes[id] : null;
  $('#edit-titre').value = t ? t.titre : '';
  $('#edit-contenu').value = t ? t.contenu : '';
  $('#edit-delete').classList.toggle('hidden', !t);
  updateStats();
  show('v-edit');
  if (!t) $('#edit-titre').focus();
}
function updateStats() {
  const c = $('#edit-contenu').value;
  const words = (c.match(/\S+/g) || []).length;
  $('#edit-stats').textContent = `${words} mot${words > 1 ? 's' : ''}`;
}
function flushEdit() {
  clearTimeout(editTimer);
  const titre = $('#edit-titre').value, contenu = $('#edit-contenu').value;
  let t = editId ? db.textes[editId] : null;
  if (!t) {
    if (!titre.trim() && !contenu.trim()) return null;
    t = { id: uuid(), titre: '', contenu: '', reglages: {}, supprime: false, created_at: nowIso() };
    db.textes[t.id] = t; editId = t.id;
    $('#edit-delete').classList.remove('hidden');
  }
  if (t.titre !== titre || t.contenu !== contenu) { t.titre = titre; t.contenu = contenu; touchTexte(t); }
  return t;
}
['#edit-titre', '#edit-contenu'].forEach(s => $(s).addEventListener('input', () => {
  updateStats(); clearTimeout(editTimer); editTimer = setTimeout(flushEdit, 500);
}));
$('#edit-import').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const txt = await f.text();
  const area = $('#edit-contenu');
  area.value = area.value ? area.value + '\n\n' + txt : txt;
  if (!$('#edit-titre').value) $('#edit-titre').value = f.name.replace(/\.[^.]+$/, '');
  e.target.value = ''; updateStats(); flushEdit();
});
$('#edit-delete').addEventListener('click', () => {
  const t = editId && db.textes[editId];
  if (!t || !confirm(`Supprimer « ${t.titre || 'Sans titre'} » ?`)) return;
  t.supprime = true; touchTexte(t); editId = null; back();
});
$('#edit-play').addEventListener('click', () => {
  const t = flushEdit();
  if (!t || !t.contenu.trim()) return toast('Écris d\'abord ton texte');
  startPrompter([t.id], 0);
});

/* ================= SETLISTS ================= */
let slId = null;
function openSetlist(id) { slId = id; renderSetlist(); show('v-setlist'); }
function slIds() {
  const s = db.setlists[slId];
  return s ? s.texte_ids.filter(id => db.textes[id] && !db.textes[id].supprime) : [];
}
function renderSetlist() {
  const s = db.setlists[slId]; if (!s) return;
  $('#sl-nom').value = s.nom;
  const ids = slIds();
  const ol = $('#sl-items'); ol.innerHTML = '';
  ids.forEach((id, i) => {
    const t = db.textes[id];
    const li = document.createElement('li');
    li.innerHTML = `<span class="li-num">${i + 1}</span><div class="li-main"><div class="li-title"></div></div>
      <button class="li-small" data-a="up" aria-label="Monter">↑</button>
      <button class="li-small" data-a="down" aria-label="Descendre">↓</button>
      <button class="li-small" data-a="rm" aria-label="Retirer">✕</button>`;
    li.querySelector('.li-title').textContent = t.titre || 'Sans titre';
    li.querySelector('.li-main').onclick = () => startPrompter(ids, i);
    li.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const arr = ids.slice();
      if (b.dataset.a === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      else if (b.dataset.a === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      else if (b.dataset.a === 'rm') arr.splice(i, 1);
      else return;
      s.texte_ids = arr; touchSetlist(s); renderSetlist();
    });
    ol.appendChild(li);
  });
  $('#sl-empty').classList.toggle('hidden', ids.length > 0);
}
$('#sl-nom').addEventListener('input', () => {
  const s = db.setlists[slId]; s.nom = $('#sl-nom').value; touchSetlist(s);
});
$('#sl-delete').addEventListener('click', () => {
  const s = db.setlists[slId];
  if (!confirm(`Supprimer la setlist « ${s.nom || 'sans nom'} » ? (les textes sont conservés)`)) return;
  s.supprime = true; touchSetlist(s); back();
});
$('#sl-play').addEventListener('click', () => {
  const ids = slIds(); if (!ids.length) return toast('Ajoute des textes d\'abord');
  startPrompter(ids, 0);
});
$('#sl-add').addEventListener('click', () => { renderPicker(); $('#picker').classList.remove('hidden'); });
$('#picker-done').addEventListener('click', () => { $('#picker').classList.add('hidden'); renderSetlist(); });
$('#picker').addEventListener('click', (e) => { if (e.target.id === 'picker') $('#picker-done').click(); });
function renderPicker() {
  const s = db.setlists[slId];
  const ul = $('#picker-list'); ul.innerHTML = '';
  const textes = liveTextes().sort((a, b) => (a.titre || '').localeCompare(b.titre || ''));
  if (!textes.length) ul.innerHTML = '<p class="empty">Aucun texte. Crée d\'abord des textes dans l\'onglet Textes.</p>';
  for (const t of textes) {
    const li = document.createElement('li');
    const on = s.texte_ids.includes(t.id);
    li.className = on ? 'checked' : '';
    li.innerHTML = `<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div><span>${on ? '✓' : '+'}</span>`;
    li.querySelector('.li-title').textContent = t.titre || 'Sans titre';
    li.querySelector('.li-sub').textContent = firstLine(t.contenu);
    li.onclick = () => {
      if (s.texte_ids.includes(t.id)) s.texte_ids = s.texte_ids.filter(x => x !== t.id);
      else s.texte_ids = s.texte_ids.concat(t.id);
      touchSetlist(s); renderPicker();
    };
    ul.appendChild(li);
  }
}

/* ================= PROMPTEUR ================= */
const P = {
  queue: [], idx: 0, pos: 0, playing: false, raf: 0, last: 0,
  speed: prefs.speed, uiTimer: 0, counting: false, countTimer: 0, autoTimer: 0, saveTimer: 0,
  vel: 0, wake: null
};
const pScroll = $('#p-scroll'), pText = $('#p-text'), pUi = $('#p-ui');

function renderMarkup(s) {
  return s.split('\n').map(line => {
    if (/^\s*#/.test(line)) return `<span class="ln sec">${esc(line.replace(/^\s*#+\s*/, ''))}</span>`;
    const html = esc(line).replace(/\[([^\]\n]*)\]/g, '<span class="cue">[$1]</span>');
    return `<span class="ln">${html || ' '}</span>`;
  }).join('');
}

function vh() { return pScroll.clientHeight; }
function maxPos() { return Math.max(0, pText.offsetHeight - vh()); }
function pxPerSec() { return P.speed * prefs.font * 0.04; }

function applyStyle() {
  const v = $('#v-prompter');
  v.classList.remove('th-dark', 'th-yellow', 'th-light');
  v.classList.add('th-' + prefs.theme);
  pScroll.className = 'p-scroll th-' + prefs.theme;
  pText.style.fontSize = prefs.font + 'px';
  pText.style.lineHeight = prefs.lh;
  pText.style.paddingLeft = pText.style.paddingRight = prefs.margin + 'vw';
  pText.style.textAlign = prefs.align;
  pText.style.textTransform = prefs.upper ? 'uppercase' : 'none';
  pText.style.paddingTop = (prefs.guide / 100 * vh()) + 'px';
  pText.style.paddingBottom = ((1 - prefs.guide / 100) * vh()) + 'px';
  const tf = [];
  if (prefs.mirror) tf.push('scaleX(-1)');
  if (prefs.flip) tf.push('scaleY(-1)');
  pScroll.style.transform = tf.join(' ');
  const g = $('#p-guide');
  g.classList.toggle('hidden', !prefs.showguide);
  const half = prefs.font * prefs.lh * 0.5;
  g.style.top = (prefs.flip ? 100 - prefs.guide : prefs.guide) + '%';
  g.style.marginTop = (prefs.flip ? -half : half) + 'px';
  setPos(P.pos);
}

function setPos(p) {
  P.pos = clamp(p, 0, maxPos());
  pText.style.transform = `translate3d(0, ${-P.pos}px, 0)`;
  const m = maxPos();
  const pct = m ? P.pos / m * 100 : 0;
  $('#p-prog').style.width = pct + '%';
  updateMeta();
}

function curTexte() { return db.textes[P.queue[P.idx]]; }

function loadSong(i) {
  P.idx = clamp(i, 0, P.queue.length - 1);
  const t = curTexte();
  pText.innerHTML = renderMarkup(t.contenu || '');
  P.speed = (t.reglages && t.reglages.vitesse) || prefs.speed;
  P.pos = 0;
  $('#p-title').textContent = t.titre || 'Sans titre';
  $('#p-prev').disabled = P.idx === 0;
  $('#p-next').disabled = P.idx >= P.queue.length - 1;
  $('#p-endcard').classList.add('hidden');
  clearTimeout(P.autoTimer);
  applyStyle();
  updateSpeedLabel();
  sendState(true);
}

function updateMeta() {
  const d = new Date();
  const clock = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  const rest = pxPerSec() ? Math.max(0, (maxPos() - P.pos) / pxPerSec()) : 0;
  const mm = Math.floor(rest / 60), ss = Math.floor(rest % 60).toString().padStart(2, '0');
  const parts = [];
  if (P.queue.length > 1) parts.push(`${P.idx + 1}/${P.queue.length}`);
  parts.push(`reste ${mm}:${ss}`, clock);
  $('#p-meta').textContent = parts.join(' · ');
}

function updateSpeedLabel() {
  $('#p-speed').textContent = P.speed;
  $('#p-play').textContent = (P.playing || P.counting) ? '❚❚' : '▶';
}

function startPrompter(ids, i) {
  P.queue = ids.slice();
  show('v-prompter');
  loadSong(i);
  showUi();
  requestWake();
  rcHostConnect();
  // L'affichage peut changer de taille une fois la vue affichée (barres iOS)
  setTimeout(applyStyle, 60);
}

function closePrompter() {
  pause();
  releaseWake();
  rcHostDisconnect();
  back();
}

function tick(t) {
  if (!P.playing) return;
  const dt = Math.min(0.1, (t - (P.last || t)) / 1000);
  P.last = t;
  if (!P.dragging) {
    setPos(P.pos + pxPerSec() * dt);
    if (P.pos >= maxPos() - 0.5) { onEnd(); return; }
  }
  P.raf = requestAnimationFrame(tick);
}

function play() {
  if (P.playing || P.counting) return;
  if (P.pos >= maxPos() - 1) setPos(0);
  $('#p-endcard').classList.add('hidden');
  if (P.pos < 2 && prefs.count > 0) return countdown(prefs.count);
  reallyPlay();
}
function reallyPlay() {
  P.playing = true; P.last = 0;
  P.raf = requestAnimationFrame(tick);
  updateSpeedLabel(); fadeUiSoon(); sendState(true);
}
function countdown(n) {
  P.counting = true; updateSpeedLabel(); fadeUiSoon(600);
  const el = $('#p-count'); el.classList.remove('hidden');
  const step = () => {
    if (!P.counting) return;
    if (n <= 0) { el.classList.add('hidden'); P.counting = false; reallyPlay(); return; }
    el.textContent = n--; P.countTimer = setTimeout(step, 1000);
  };
  step(); sendState(true);
}
function pause() {
  P.playing = false; cancelAnimationFrame(P.raf);
  if (P.counting) { P.counting = false; clearTimeout(P.countTimer); $('#p-count').classList.add('hidden'); }
  updateSpeedLabel(); showUi(); sendState(true);
}
function toggle() { (P.playing || P.counting) ? pause() : play(); }

function onEnd() {
  pause();
  if (P.idx < P.queue.length - 1) {
    const next = db.textes[P.queue[P.idx + 1]];
    $('#p-endtitle').textContent = 'Suivant : ' + (next.titre || 'Sans titre');
    $('#p-endcard').classList.remove('hidden');
    if (prefs.autonext) P.autoTimer = setTimeout(() => goSong(P.idx + 1, true), 2500);
  } else {
    toast(P.queue.length > 1 ? 'Fin de la setlist 🎉' : 'Fin du texte');
  }
}
function goSong(i, autoplay) {
  if (i < 0 || i >= P.queue.length) return;
  const was = P.playing || P.counting || autoplay;
  pause(); loadSong(i);
  if (was) play();
}

function changeSpeed(d) {
  P.speed = clamp(P.speed + d, 1, 60);
  updateSpeedLabel(); updateMeta(); sendState(true);
  clearTimeout(P.saveTimer);
  P.saveTimer = setTimeout(() => {
    const t = curTexte(); if (!t) return;
    t.reglages = Object.assign({}, t.reglages, { vitesse: P.speed });
    touchTexte(t);
  }, 1500);
}
function nudge(fraction) { setPos(P.pos + vh() * fraction); sendState(true); }

/* --- affichage des commandes --- */
function showUi() { pUi.classList.remove('faded'); clearTimeout(P.uiTimer); }
function fadeUiSoon(ms = 2500) {
  clearTimeout(P.uiTimer);
  P.uiTimer = setTimeout(() => { if (P.playing || P.counting) pUi.classList.add('faded'); }, ms);
}

/* --- gestes : glisser pour se déplacer, toucher pour lecture/pause --- */
let tStart = null;
pScroll.addEventListener('touchstart', (e) => {
  const y = e.touches[0].clientY;
  tStart = { y, pos: P.pos, t: performance.now(), lastY: y, lastT: performance.now(), moved: false };
  P.dragging = true; P.vel = 0; cancelAnimationFrame(P.inertia);
}, { passive: true });
pScroll.addEventListener('touchmove', (e) => {
  if (!tStart) return;
  e.preventDefault();
  const y = e.touches[0].clientY, dir = prefs.flip ? -1 : 1;
  if (Math.abs(y - tStart.y) > 8) tStart.moved = true;
  const now = performance.now();
  P.vel = dir * (tStart.lastY - y) / Math.max(1, now - tStart.lastT);
  tStart.lastY = y; tStart.lastT = now;
  setPos(tStart.pos + dir * (tStart.y - y));
}, { passive: false });
pScroll.addEventListener('touchend', () => {
  if (!tStart) return;
  const tap = !tStart.moved && performance.now() - tStart.t < 400;
  P.dragging = false; tStart = null; lastTouchEnd = performance.now();
  if (tap) { toggle(); return; }
  // petite inertie après un glissé
  let v = P.vel * 16;
  const step = () => {
    if (Math.abs(v) < 0.5) { sendState(true); return; }
    setPos(P.pos + v); v *= 0.92; P.inertia = requestAnimationFrame(step);
  };
  if (!P.playing) step(); else sendState(true);
});
let lastTouchEnd = 0;
pScroll.addEventListener('click', () => { if (performance.now() - lastTouchEnd > 800) toggle(); });
pScroll.addEventListener('wheel', (e) => { e.preventDefault(); setPos(P.pos + e.deltaY * (prefs.flip ? -1 : 1)); }, { passive: false });
pUi.addEventListener('touchstart', () => { if (!pUi.classList.contains('faded')) { showUi(); if (P.playing) fadeUiSoon(); } }, { passive: true });

$('#p-play').onclick = toggle;
$('#p-faster').onclick = () => changeSpeed(1);
$('#p-slower').onclick = () => changeSpeed(-1);
$('#p-prev').onclick = () => goSong(P.idx - 1);
$('#p-next').onclick = () => goSong(P.idx + 1);
$('#p-endnext').onclick = () => goSong(P.idx + 1, true);
$('#p-close').onclick = closePrompter;

/* --- clavier et pédales Bluetooth --- */
document.addEventListener('keydown', (e) => {
  if ($('#v-prompter').classList.contains('hidden')) return;
  if (!$('#p-settings').classList.contains('hidden') && e.key !== 'Escape') return;
  const k = e.key;
  let handled = true;
  if (k === ' ' || k === 'Enter' || k === 'k') toggle();
  else if (k === 'ArrowDown' || k === 'PageDown') nudge(0.35);
  else if (k === 'ArrowUp' || k === 'PageUp') nudge(-0.35);
  else if (k === 'ArrowRight') goSong(P.idx + 1);
  else if (k === 'ArrowLeft') goSong(P.idx - 1);
  else if (k === '+' || k === '=') changeSpeed(1);
  else if (k === '-' || k === '_') changeSpeed(-1);
  else if (k === 'Home') setPos(0);
  else if (k === 'Escape') { if (!$('#p-settings').classList.contains('hidden')) closeSettings(); else closePrompter(); }
  else handled = false;
  if (handled) e.preventDefault();
});

window.addEventListener('resize', () => { if (!$('#v-prompter').classList.contains('hidden')) applyStyle(); });
setInterval(() => { if (!$('#v-prompter').classList.contains('hidden')) updateMeta(); }, 15000);

/* --- garder l'écran allumé --- */
async function requestWake() {
  try { if ('wakeLock' in navigator) P.wake = await navigator.wakeLock.request('screen'); } catch {}
}
function releaseWake() { try { P.wake && P.wake.release(); } catch {} P.wake = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#v-prompter').classList.contains('hidden')) requestWake();
  if (document.visibilityState === 'visible') scheduleSync(500);
});

/* --- réglages --- */
const sliders = { font: 's-font', speed: 's-speed', lh: 's-lh', margin: 's-margin', guide: 's-guide', count: 's-count' };
const fmt = {
  font: v => v + ' px', speed: v => v, lh: v => (+v).toFixed(2), margin: v => v + ' %',
  guide: v => v + ' %', count: v => +v ? v + ' s' : 'aucun'
};
const checks = { mirror: 's-mirror', flip: 's-flip', upper: 's-upper', showguide: 's-showguide', autonext: 's-autonext' };

function renderSettings() {
  for (const [k, id] of Object.entries(sliders)) {
    const v = k === 'speed' ? P.speed : prefs[k];
    $('#' + id).value = v; $('#' + id + '-v').textContent = fmt[k](v);
  }
  for (const [k, id] of Object.entries(checks)) $('#' + id).checked = !!prefs[k];
  $$('#s-align button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.align));
  $$('#s-theme button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.theme));
  $('#s-code').textContent = prefs.code;
  $('#s-remote-status').textContent = !sb ? 'Télécommande indisponible hors ligne.' :
    (RC.connected ? 'Télécommande connectée ✓' : 'Ouvre 📡 Télécommande sur un autre téléphone.');
}
for (const [k, id] of Object.entries(sliders)) {
  $('#' + id).addEventListener('input', (e) => {
    const v = +e.target.value;
    if (k === 'speed') { changeSpeed(v - P.speed); prefs.speed = v; }
    else prefs[k] = v;
    $('#' + id + '-v').textContent = fmt[k](v);
    savePrefs(); applyStyle();
  });
}
for (const [k, id] of Object.entries(checks)) {
  $('#' + id).addEventListener('change', (e) => { prefs[k] = e.target.checked; savePrefs(); applyStyle(); });
}
$$('#s-align button').forEach(b => b.onclick = () => { prefs.align = b.dataset.v; savePrefs(); applyStyle(); renderSettings(); });
$$('#s-theme button').forEach(b => b.onclick = () => { prefs.theme = b.dataset.v; savePrefs(); applyStyle(); renderSettings(); });
$('#p-settings-btn').onclick = () => { pause(); renderSettings(); $('#p-settings').classList.remove('hidden'); };
function closeSettings() { $('#p-settings').classList.add('hidden'); }
$('#p-settings-done').onclick = closeSettings;
$('#p-settings').addEventListener('click', (e) => { if (e.target.id === 'p-settings') closeSettings(); });

/* ================= SUPABASE ================= */
const cfg = window.PROMPTEUR_CONFIG || {};
let sb = null;
try {
  if (window.supabase && cfg.supabaseUrl) {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
} catch (e) { console.warn('Supabase indisponible', e); }

let session = null, syncTimer = null, syncing = false;

function scheduleSync(ms = 2000) {
  if (!session) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms);
}

function mergeRemote(map, rows) {
  let changed = false;
  for (const r of rows) {
    const l = map[r.id];
    if (!l || (!l._dirty && ts(r.updated_at) !== ts(l.updated_at)) || (l._dirty && ts(r.updated_at) > ts(l.updated_at))) {
      const { user_id, ...rest } = r;
      map[r.id] = Object.assign(rest, { _dirty: false });
      changed = true;
    }
  }
  return changed;
}

async function pushDirty(table, map, fields) {
  const dirty = Object.values(map).filter(x => x._dirty);
  if (!dirty.length) return;
  const rows = dirty.map(x => {
    const o = {}; for (const f of fields) o[f] = x[f]; return o;
  });
  const { error } = await sb.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  for (const x of dirty) {
    const cur = map[x.id];
    if (cur && cur.updated_at === x.updated_at) cur._dirty = false;
  }
}

async function sync() {
  if (!sb || !session || syncing || !navigator.onLine) return;
  syncing = true; setBanner('Synchronisation…');
  try {
    const [a, b] = await Promise.all([
      sb.from('prompteur_textes').select('*'),
      sb.from('prompteur_setlists').select('*')
    ]);
    if (a.error) throw a.error; if (b.error) throw b.error;
    const c1 = mergeRemote(db.textes, a.data), c2 = mergeRemote(db.setlists, b.data);
    for (const t of Object.values(db.textes)) { t.reglages = t.reglages || {}; t.created_at = t.created_at || nowIso(); }
    for (const s of Object.values(db.setlists)) { s.texte_ids = s.texte_ids || []; s.created_at = s.created_at || nowIso(); }
    await pushDirty('prompteur_textes', db.textes, ['id', 'titre', 'contenu', 'reglages', 'supprime', 'updated_at', 'created_at']);
    await pushDirty('prompteur_setlists', db.setlists, ['id', 'nom', 'texte_ids', 'supprime', 'updated_at', 'created_at']);
    db.save();
    store.set('pr_lastsync', nowIso());
    setBanner(null);
    if ((c1 || c2) && !$('#v-home').classList.contains('hidden')) renderHome();
    renderAccount();
  } catch (e) {
    console.warn(e);
    setBanner('Synchro impossible pour l\'instant — tes textes restent sur l\'appareil.');
  } finally { syncing = false; }
}

function setBanner(msg) {
  const b = $('#sync-banner');
  if (!msg) return b.classList.add('hidden');
  b.textContent = msg; b.classList.remove('hidden');
}
window.addEventListener('online', () => scheduleSync(500));

/* ================= COMPTE ================= */
$('#btn-account').onclick = () => { renderAccount(); show('v-account'); };
function renderAccount() {
  $('#acc-out').classList.toggle('hidden', !!session);
  $('#acc-in').classList.toggle('hidden', !session);
  if (session) {
    $('#acc-who').textContent = session.user.email;
    const l = store.get('pr_lastsync', null);
    $('#acc-last').textContent = l ? 'Dernière synchro : ' + new Date(l).toLocaleString('fr-FR') : '';
  }
  $('#btn-account').textContent = session ? '☁︎' : '👤';
}
const accMsg = (m) => { $('#acc-msg').textContent = m || ''; };
function creds() {
  const email = $('#acc-email').value.trim(), password = $('#acc-pass').value;
  if (!email || password.length < 6) { accMsg('Entre ton email et un mot de passe d\'au moins 6 caractères.'); return null; }
  return { email, password };
}
function frErr(e) {
  const m = (e && e.message) || String(e);
  if (/Invalid login/i.test(m)) return 'Email ou mot de passe incorrect.';
  if (/not confirmed/i.test(m)) return 'Confirme d\'abord ton email (regarde ta boîte mail), puis reconnecte-toi.';
  if (/already registered/i.test(m)) return 'Ce compte existe déjà : utilise « Se connecter ».';
  if (/fetch|network/i.test(m)) return 'Pas de connexion internet.';
  return m;
}
$('#acc-login').onclick = async () => {
  const c = creds(); if (!c || !sb) return; accMsg('Connexion…');
  const { error } = await sb.auth.signInWithPassword(c);
  accMsg(error ? frErr(error) : 'Connecté ✓');
};
$('#acc-signup').onclick = async () => {
  const c = creds(); if (!c || !sb) return; accMsg('Création du compte…');
  const { data, error } = await sb.auth.signUp({ ...c, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) return accMsg(frErr(error));
  accMsg(data.session ? 'Compte créé et connecté ✓' : 'Compte créé ! Clique sur le lien reçu par email, puis reviens ici et connecte-toi.');
};
$('#acc-reset').onclick = async () => {
  const email = $('#acc-email').value.trim(); if (!email) return accMsg('Entre ton email ci-dessus.');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  accMsg(error ? frErr(error) : 'Email de réinitialisation envoyé.');
};
$('#acc-sync').onclick = () => sync();
$('#acc-logout').onclick = async () => {
  const wipe = confirm('Effacer aussi les textes de CET appareil ?\n(Ils restent sauvegardés dans ton compte.)\n\nOK = effacer · Annuler = garder');
  await sb.auth.signOut();
  if (wipe) { db.textes = {}; db.setlists = {}; db.save(); }
  renderAccount(); renderHome();
};

if (sb) {
  sb.auth.onAuthStateChange((event, s) => {
    session = s;
    renderAccount();
    if (event === 'PASSWORD_RECOVERY') {
      const p = prompt('Nouveau mot de passe (6 caractères min.) :');
      if (p && p.length >= 6) sb.auth.updateUser({ password: p }).then(({ error }) => toast(error ? frErr(error) : 'Mot de passe modifié ✓'));
    }
    if (s && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) scheduleSync(300);
  });
}

/* --- sauvegarde fichier --- */
$('#acc-export').onclick = () => {
  const data = { app: 'prompteur', version: 1, date: nowIso(), textes: liveTextes(), setlists: liveSetlists() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `prompteur-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$('#acc-importfile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    let n = 0;
    for (const t of data.textes || []) {
      if (!t.id) continue;
      db.textes[t.id] = { id: t.id, titre: t.titre || '', contenu: t.contenu || '', reglages: t.reglages || {}, supprime: false, created_at: t.created_at || nowIso(), updated_at: nowIso(), _dirty: true }; n++;
    }
    for (const s of data.setlists || []) {
      if (!s.id) continue;
      db.setlists[s.id] = { id: s.id, nom: s.nom || '', texte_ids: s.texte_ids || [], supprime: false, created_at: s.created_at || nowIso(), updated_at: nowIso(), _dirty: true };
    }
    db.save(); scheduleSync(300);
    accMsg(`${n} texte(s) importé(s) ✓`);
  } catch { accMsg('Fichier de sauvegarde invalide.'); }
  e.target.value = '';
});

/* ================= TÉLÉCOMMANDE (Supabase Realtime) ================= */
const RC = { host: null, client: null, connected: false, lastSeen: 0, stateTimer: 0, lastSend: 0, beat: 0 };

function chanName(code) { return 'prompteur-rc-' + code.toUpperCase(); }

/* côté prompteur */
function rcHostConnect() {
  if (!sb || RC.host) return;
  RC.host = sb.channel(chanName(prefs.code), { config: { broadcast: { self: false } } });
  RC.host.on('broadcast', { event: 'cmd' }, ({ payload }) => {
    RC.connected = true; RC.lastSeen = Date.now();
    const a = payload && payload.a;
    if (a === 'toggle') toggle();
    else if (a === 'speed+') changeSpeed(1);
    else if (a === 'speed-') changeSpeed(-1);
    else if (a === 'fwd') nudge(0.35);
    else if (a === 'back') nudge(-0.35);
    else if (a === 'top') { pause(); setPos(0); }
    else if (a === 'next') goSong(P.idx + 1);
    else if (a === 'prev') goSong(P.idx - 1);
    else if (a === 'goto') goSong(+payload.i);
    sendState(true);
  });
  RC.host.subscribe();
  RC.beat = setInterval(() => {
    if (Date.now() - RC.lastSeen > 15000) RC.connected = false;
    sendState(true);
  }, 2000);
}
function rcHostDisconnect() {
  clearInterval(RC.beat);
  if (RC.host) { sb.removeChannel(RC.host); RC.host = null; }
  RC.connected = false;
}
function sendState(force) {
  if (!RC.host) return;
  const now = Date.now();
  if (!force && now - RC.lastSend < 300) return;
  RC.lastSend = now;
  const t = curTexte();
  const m = maxPos();
  RC.host.send({
    type: 'broadcast', event: 'state',
    payload: {
      titre: t ? (t.titre || 'Sans titre') : '', idx: P.idx, n: P.queue.length,
      playing: P.playing || P.counting, speed: P.speed, prog: m ? P.pos / m : 0,
      songs: P.queue.map(id => (db.textes[id] && db.textes[id].titre) || 'Sans titre')
    }
  });
}

/* côté téléphone télécommande */
$('#btn-remote').onclick = () => {
  if (!sb) return toast('Télécommande indisponible');
  $('#rc-code').value = store.get('pr_rc_last', '');
  $('#rc-connect').classList.remove('hidden'); $('#rc-pad').classList.add('hidden');
  show('v-remote');
};
$('#rc-join').onclick = () => {
  const code = $('#rc-code').value.trim().toUpperCase();
  if (code.length !== 6) return toast('Le code fait 6 caractères');
  store.set('pr_rc_last', code);
  rcLeave();
  RC.client = sb.channel(chanName(code), { config: { broadcast: { self: false } } });
  RC.client.on('broadcast', { event: 'state' }, ({ payload }) => { RC.lastSeen = Date.now(); renderRemote(payload); });
  RC.client.subscribe((status) => {
    if (status === 'SUBSCRIBED') rcSend('ping');
  });
  $('#rc-connect').classList.add('hidden'); $('#rc-pad').classList.remove('hidden');
  $('#rc-title').textContent = 'En attente du prompteur…';
  $('#rc-sub').textContent = 'Lance un texte sur l\'autre appareil (code ' + code + ').';
  RC.watch = setInterval(() => {
    if (Date.now() - RC.lastSeen > 6000) {
      $('#rc-title').textContent = 'Prompteur non détecté';
      $('#rc-sub').textContent = 'Vérifie le code et qu\'un texte est ouvert sur l\'autre appareil.';
    }
  }, 2000);
};
function rcSend(a, extra) {
  if (!RC.client) return;
  RC.client.send({ type: 'broadcast', event: 'cmd', payload: Object.assign({ a }, extra) });
  if (navigator.vibrate) navigator.vibrate(15);
}
function rcLeave() {
  clearInterval(RC.watch);
  if (RC.client) { sb.removeChannel(RC.client); RC.client = null; }
}
$('#rc-leave').onclick = () => { rcLeave(); $('#rc-connect').classList.remove('hidden'); $('#rc-pad').classList.add('hidden'); };
$('#rc-play').onclick = () => rcSend('toggle');
$$('[data-rc]').forEach(b => b.onclick = () => rcSend(b.dataset.rc));

function renderRemote(s) {
  $('#rc-title').textContent = s.titre;
  $('#rc-sub').textContent = (s.n > 1 ? `Morceau ${s.idx + 1}/${s.n} · ` : '') + (s.playing ? 'Défilement en cours' : 'En pause');
  $('#rc-prog').style.width = (s.prog * 100) + '%';
  $('#rc-play').textContent = s.playing ? '❚❚' : '▶';
  $('#rc-speed').textContent = s.speed;
  const ol = $('#rc-songs');
  const key = JSON.stringify([s.songs, s.idx]);
  if (ol.dataset.key === key) return;
  ol.dataset.key = key; ol.innerHTML = '';
  if (s.n > 1) s.songs.forEach((titre, i) => {
    const li = document.createElement('li');
    li.className = i === s.idx ? 'current' : '';
    li.innerHTML = `<span class="li-num">${i + 1}</span><div class="li-main"><div class="li-title"></div></div>`;
    li.querySelector('.li-title').textContent = titre;
    li.onclick = () => rcSend('goto', { i });
    ol.appendChild(li);
  });
}

/* ================= DÉMARRAGE ================= */
if (!Object.keys(db.textes).length && !store.get('pr_welcomed', false)) {
  const t = {
    id: uuid(), titre: 'Exemple – Mode d\'emploi', reglages: {}, supprime: false, created_at: nowIso(),
    contenu: `# Bienvenue
Ceci est ton prompteur.
Touche l'écran pour lancer ou mettre en pause.
Glisse le doigt pour avancer ou reculer.

# Mise en forme
Commence une ligne par # pour faire un titre de section, comme « Refrain ».
[Les indications entre crochets apparaissent en couleur]

# En concert
Crée une setlist pour enchaîner tes morceaux.
Règle la vitesse de chaque chanson : elle est mémorisée.
Utilise un deuxième téléphone comme télécommande 📡
ou une pédale Bluetooth.

# Refrain
Et voilà, c'est à toi !
[Fin]`
  };
  t.updated_at = nowIso();
  db.textes[t.id] = t; db.save(); store.set('pr_welcomed', true);
}
renderHome();
renderAccount();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
})();
