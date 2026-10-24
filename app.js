/* Prompteur — appli web installable (PWA) pour concerts, mariages et lives.
   Les données sont stockées sur l'appareil (fonctionne hors ligne) et synchronisées
   avec Supabase par équipe : l'admin gère textes, setlists et membres ; les membres
   lisent, lancent le prompteur et pilotent la télécommande. */
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
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ic = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const setIcon = (el, name) => { el.innerHTML = ic(name); };

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

function guessDevice() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  return 'Ordinateur';
}

const defaults = {
  font: window.innerWidth < 500 ? 48 : 72,
  speed: 15, lh: 1.35, margin: 6, guide: 30, count: 3,
  align: 'left', theme: 'dark', mirror: false, flip: false, upper: false,
  showguide: true, autonext: false, deviceId: uuid(), deviceName: guessDevice()
};
const prefs = Object.assign({}, defaults, store.get('pr_prefs', {}));
delete prefs.code;
const savePrefs = () => store.set('pr_prefs', prefs);
savePrefs();

/* ================= ÉQUIPE ================= */
const team = {
  list: store.get('pr_teams', []),          // [{id, nom, code_invitation, role}]
  id: store.get('pr_team', null),
  members: [],
  current() { return this.list.find(t => t.id === this.id) || null; },
  save() { store.set('pr_teams', this.list); store.set('pr_team', this.id); }
};
let session = null;

// Sans compte : tout est local et modifiable. Avec compte : seuls les admins modifient.
function canEdit() {
  if (!session) return true;
  const t = team.current();
  return !!t && t.role === 'admin';
}
function inScope(x) { return session ? x.equipe_id === team.id : !x.equipe_id; }
function scopeId() { return session ? team.id : null; }

const liveTextes = () => Object.values(db.textes).filter(t => !t.supprime && inScope(t));
const liveSetlists = () => Object.values(db.setlists).filter(s => !s.supprime && inScope(s));

function touchTexte(t) { t.updated_at = nowIso(); t._dirty = true; db.save(); scheduleSync(); }
function touchSetlist(s) { s.updated_at = nowIso(); s._dirty = true; db.save(); scheduleSync(); }

/* ================= UI GÉNÉRALE ================= */
let toastTimer;
function toast(msg, ms = 2200) {
  const el = $('#toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/* --- fenêtres modales (jamais de boîte de dialogue du navigateur) --- */
let modalResolve = null;
function modal({ title, message = '', icon = null, danger = false, input = null, buttons }) {
  if (modalResolve) modalResolve(null);
  const el = $('#modal'), inp = $('#modal-input'), acts = $('#modal-actions');
  const ico = $('#modal-icon');
  ico.classList.toggle('hidden', !icon);
  ico.classList.toggle('danger', danger);
  if (icon) ico.innerHTML = ic(icon);
  $('#modal-title').textContent = title;
  $('#modal-msg').textContent = message;
  $('#modal-msg').classList.toggle('hidden', !message);
  inp.classList.toggle('hidden', !input);
  if (input) {
    inp.type = input.type || 'text';
    inp.value = input.value || '';
    inp.placeholder = input.placeholder || '';
  }
  acts.innerHTML = '';
  return new Promise((resolve) => {
    const done = (v) => {
      if (modalResolve !== finish) return;
      modalResolve = null; el.classList.add('hidden'); resolve(v);
    };
    const finish = done;
    modalResolve = finish;
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = b.style === 'danger' ? 'primary danger-btn' : b.style === 'ghost' ? 'ghost' : b.style === 'secondary' ? 'secondary' : 'primary';
      btn.textContent = b.label;
      btn.onclick = () => {
        if (input && b.value === true) {
          const v = inp.value.trim();
          if (input.min && v.length < input.min) { inp.focus(); toast(input.minMsg || 'Valeur trop courte'); return; }
          return done(v);
        }
        done(b.value);
      };
      acts.appendChild(btn);
    }
    el.classList.remove('hidden');
    if (input) setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && modalResolve) modalResolve(null); });
// Tant qu'une fenêtre est ouverte, le clavier (et la pédale) ne pilote plus le prompteur.
document.addEventListener('keydown', (e) => {
  if (!modalResolve) return;
  if (e.key === 'Escape') { e.preventDefault(); modalResolve(null); }
  else if (e.key === 'Enter' && e.target.id === 'modal-input') {
    e.preventDefault(); const btn = $('#modal-actions').firstElementChild; if (btn) btn.click();
  }
  e.stopImmediatePropagation();
}, true);

function confirmModal(title, message, ok, opts = {}) {
  return modal({
    title, message, icon: opts.icon || (opts.danger ? 'trash' : null), danger: !!opts.danger,
    buttons: [{ label: ok, value: true, style: opts.danger ? 'danger' : 'primary' }, { label: 'Annuler', value: false, style: 'ghost' }]
  }).then(v => v === true);
}
function promptModal(title, message, ok, input) {
  return modal({
    title, message, icon: input.icon || null, input,
    buttons: [{ label: ok, value: true, style: 'primary' }, { label: 'Annuler', value: false, style: 'ghost' }]
  }).then(v => (typeof v === 'string' && v) ? v : null);
}

const stack = [];
const visible = (id) => !$('#' + id).classList.contains('hidden');
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
  if (visible('v-edit')) flushEdit();
  if (visible('v-remote')) RC.target = null;
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
  const edit = canEdit();
  const t = team.current();
  const chip = $('#team-chip');
  chip.classList.toggle('hidden', !session || !t);
  if (session && t) chip.innerHTML = ic('users') + esc(t.nom) + (t.role === 'admin' ? ' · admin' : '');
  $('#fab').classList.toggle('hidden', !edit);

  const q = $('#search').value.trim().toLowerCase();
  const textes = liveTextes()
    .filter(t => !q || (t.titre + ' ' + t.contenu).toLowerCase().includes(q))
    .sort((a, b) => (a.titre || '').localeCompare(b.titre || '', 'fr'));
  const ul = $('#list-textes'); ul.innerHTML = '';
  for (const t of textes) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div>
      <button class="li-play" aria-label="Lancer">${ic('play')}</button>`;
    li.querySelector('.li-title').textContent = t.titre || 'Sans titre';
    li.querySelector('.li-sub').textContent = firstLine(t.contenu) || 'Vide';
    li.querySelector('.li-main').onclick = () => openEdit(t.id);
    li.querySelector('.li-play').onclick = () => startPrompter([t.id], 0);
    ul.appendChild(li);
  }
  const et = $('#empty-textes');
  et.innerHTML = edit ? 'Aucun texte pour l\'instant.<br>Appuie sur <b>+</b> pour ajouter ta première chanson ou ton discours.'
    : 'Aucun texte dans cette équipe.<br>Les textes ajoutés par l\'admin apparaîtront ici.';
  et.classList.toggle('hidden', textes.length > 0 || !!q);

  const sls = liveSetlists().sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
  const ul2 = $('#list-setlists'); ul2.innerHTML = '';
  for (const s of sls) {
    const ids = setlistIds(s);
    const li = document.createElement('li');
    li.innerHTML = `<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div>
      <button class="li-play" aria-label="Lancer">${ic('play')}</button>`;
    li.querySelector('.li-title').textContent = s.nom || 'Setlist sans nom';
    li.querySelector('.li-sub').textContent = `${ids.length} morceau${ids.length > 1 ? 'x' : ''} · ` +
      ids.map(id => db.textes[id].titre || 'Sans titre').join(', ');
    li.querySelector('.li-main').onclick = () => openSetlist(s.id);
    li.querySelector('.li-play').onclick = () => ids.length ? startPrompter(ids, 0) : toast('Setlist vide');
    ul2.appendChild(li);
  }
  const es = $('#empty-setlists');
  es.innerHTML = edit ? 'Aucune setlist.<br>Crée une setlist pour enchaîner tes morceaux pendant un concert ou un mariage.'
    : 'Aucune setlist dans cette équipe.';
  es.classList.toggle('hidden', sls.length > 0);
}

$('#team-chip').onclick = () => openAccount();
$('#fab').addEventListener('click', () => {
  if (!canEdit()) return;
  if (currentTab === 'textes') openEdit(null);
  else {
    const s = { id: uuid(), nom: '', texte_ids: [], supprime: false, created_at: nowIso(), equipe_id: scopeId() };
    db.setlists[s.id] = s; touchSetlist(s); openSetlist(s.id);
  }
});

/* ================= ÉDITEUR DE TEXTE ================= */
let editId = null, editTimer = null;
function openEdit(id) {
  editId = id;
  const t = id ? db.textes[id] : null;
  const edit = canEdit();
  $('#edit-titre').value = t ? t.titre : '';
  $('#edit-contenu').value = t ? t.contenu : '';
  $('#edit-titre').readOnly = $('#edit-contenu').readOnly = !edit;
  $('#edit-ro').classList.toggle('hidden', edit);
  $('#edit-import-btn').classList.toggle('hidden', !edit);
  $('#edit-delete').classList.toggle('hidden', !t || !edit);
  updateStats();
  show('v-edit');
  if (!t && edit) $('#edit-titre').focus();
}
function updateStats() {
  const c = $('#edit-contenu').value;
  const words = (c.match(/\S+/g) || []).length;
  $('#edit-stats').textContent = `${words} mot${words > 1 ? 's' : ''}`;
}
function flushEdit() {
  clearTimeout(editTimer);
  let t = editId ? db.textes[editId] : null;
  if (!canEdit()) return t;
  const titre = $('#edit-titre').value, contenu = $('#edit-contenu').value;
  if (!t) {
    if (!titre.trim() && !contenu.trim()) return null;
    t = { id: uuid(), titre: '', contenu: '', reglages: {}, supprime: false, created_at: nowIso(), equipe_id: scopeId() };
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
$('#edit-delete').addEventListener('click', async () => {
  const t = editId && db.textes[editId];
  if (!t || !canEdit()) return;
  if (!await confirmModal('Supprimer ce texte ?', `« ${t.titre || 'Sans titre'} » sera supprimé pour toute l'équipe.`, 'Supprimer', { danger: true })) return;
  t.supprime = true; touchTexte(t); editId = null; back();
});
$('#edit-play').addEventListener('click', () => {
  const t = flushEdit();
  if (!t || !t.contenu.trim()) return toast('Écris d\'abord ton texte');
  startPrompter([t.id], 0);
});

/* ================= SETLISTS ================= */
let slId = null;
function setlistIds(s) { return s ? s.texte_ids.filter(id => db.textes[id] && !db.textes[id].supprime) : []; }
function openSetlist(id) { slId = id; renderSetlist(); show('v-setlist'); }
function renderSetlist() {
  const s = db.setlists[slId]; if (!s) return;
  const edit = canEdit();
  $('#sl-nom').value = s.nom;
  $('#sl-nom').readOnly = !edit;
  $('#sl-delete').classList.toggle('hidden', !edit);
  $('#sl-add').classList.toggle('hidden', !edit);
  const ids = setlistIds(s);
  const ol = $('#sl-items'); ol.innerHTML = '';
  ids.forEach((id, i) => {
    const t = db.textes[id];
    const li = document.createElement('li');
    li.innerHTML = `<span class="li-num">${i + 1}</span><div class="li-main"><div class="li-title"></div></div>` + (edit ? `
      <button class="li-small" data-a="up" aria-label="Monter">${ic('up')}</button>
      <button class="li-small" data-a="down" aria-label="Descendre">${ic('down')}</button>
      <button class="li-small" data-a="rm" aria-label="Retirer">${ic('x')}</button>` : '');
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
  if (!canEdit()) return;
  const s = db.setlists[slId]; s.nom = $('#sl-nom').value; touchSetlist(s);
});
$('#sl-delete').addEventListener('click', async () => {
  const s = db.setlists[slId];
  if (!canEdit()) return;
  if (!await confirmModal('Supprimer cette setlist ?', `« ${s.nom || 'Setlist sans nom'} » sera supprimée. Les textes qu'elle contient sont conservés.`, 'Supprimer', { danger: true })) return;
  s.supprime = true; touchSetlist(s); back();
});
$('#sl-play').addEventListener('click', () => {
  const ids = setlistIds(db.setlists[slId]); if (!ids.length) return toast('Ajoute des textes d\'abord');
  startPrompter(ids, 0);
});
$('#sl-add').addEventListener('click', () => { renderPicker(); $('#picker').classList.remove('hidden'); });
$('#picker-done').addEventListener('click', () => { $('#picker').classList.add('hidden'); renderSetlist(); });
$('#picker').addEventListener('click', (e) => { if (e.target.id === 'picker') $('#picker-done').click(); });
function renderPicker() {
  const s = db.setlists[slId];
  const ul = $('#picker-list'); ul.innerHTML = '';
  const textes = liveTextes().sort((a, b) => (a.titre || '').localeCompare(b.titre || '', 'fr'));
  if (!textes.length) ul.innerHTML = '<p class="empty">Aucun texte. Crée d\'abord des textes dans l\'onglet Textes.</p>';
  for (const t of textes) {
    const li = document.createElement('li');
    const on = s.texte_ids.includes(t.id);
    li.className = on ? 'checked' : '';
    li.innerHTML = `<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div><span class="li-mark">${ic(on ? 'check' : 'plus')}</span>`;
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
  vel: 0, wake: null, open: false
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
  $('#p-prog').style.width = (m ? P.pos / m * 100 : 0) + '%';
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
  trackPresence();
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

let shownPlaying = null;
function updateSpeedLabel() {
  $('#p-speed').textContent = P.speed;
  const on = P.playing || P.counting;
  if (on !== shownPlaying) { setIcon($('#p-play'), on ? 'pause' : 'play'); shownPlaying = on; }
}

function startPrompter(ids, i) {
  P.queue = ids.slice();
  P.open = true;
  show('v-prompter');
  loadSong(i);
  showUi();
  requestWake();
  // L'affichage peut changer de taille une fois la vue affichée (barres iOS)
  setTimeout(applyStyle, 60);
}

function closePrompter() {
  pause();
  P.open = false;
  releaseWake();
  untrackPresence();
  sendState(true);
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
  updateSpeedLabel(); fadeUiSoon(); sendState(true); trackPresence();
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
  const was = P.playing || P.counting;
  P.playing = false; cancelAnimationFrame(P.raf);
  if (P.counting) { P.counting = false; clearTimeout(P.countTimer); $('#p-count').classList.add('hidden'); }
  updateSpeedLabel(); showUi(); sendState(true);
  if (was) trackPresence();
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
    toast(P.queue.length > 1 ? 'Fin de la setlist' : 'Fin du texte');
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
    // Un membre garde sa vitesse sur son appareil ; l'admin la sauvegarde pour toute l'équipe.
    if (canEdit()) touchTexte(t); else db.save();
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
let tStart = null, lastTouchEnd = 0;
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
  if (!P.open) return;
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

window.addEventListener('resize', () => { if (P.open) applyStyle(); });
setInterval(() => { if (P.open) updateMeta(); }, 15000);

/* --- garder l'écran allumé --- */
async function requestWake() {
  try { if ('wakeLock' in navigator) P.wake = await navigator.wakeLock.request('screen'); } catch {}
}
function releaseWake() { try { P.wake && P.wake.release(); } catch {} P.wake = null; }
// Quand l'appli passe en arrière-plan, l'iPhone coupe sa connexion sans toujours prévenir.
// Au retour, on recrée donc la connexion à l'équipe dès que l'appli est restée cachée quelques secondes.
let hiddenAt = 0;
async function onAppBack() {
  if (P.open) requestWake();
  scheduleSync(500);
  if (!session || !sb) return;
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  if (away > 3000 || (TC.ch && !teamChannelOk())) {
    try {
      const { data } = await sb.auth.getSession();          // renouvelle le jeton s'il a expiré
      if (data && data.session) { session = data.session; sb.realtime.setAuth(data.session.access_token); }
    } catch {}
    try { sb.realtime.disconnect(); } catch {}            // la connexion d'avant est souvent morte
    connectTeam(true);
  } else connectTeam();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  onAppBack();
});
window.addEventListener('pageshow', (e) => { if (e.persisted) onAppBack(); });

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
  $('#s-device').value = prefs.deviceName;
  const t = team.current();
  $('#s-remote-status').textContent = !session || !t
    ? 'Connecte-toi à une équipe pour piloter ce prompteur depuis un autre téléphone.'
    : TC.ready ? `Visible dans la télécommande de l'équipe « ${t.nom} ».`
    : 'Connexion à l\'équipe en cours…';
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
$('#s-device').addEventListener('change', (e) => {
  prefs.deviceName = e.target.value.trim() || guessDevice(); savePrefs(); trackPresence();
});
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

let syncTimer = null, syncing = false;

function scheduleSync(ms = 2000) {
  if (!session) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms);
}

function mergeRemote(map, rows) {
  let changed = false;
  for (const r of rows) {
    const l = map[r.id];
    if (!l || l.equipe_id !== r.equipe_id || (!l._dirty && ts(r.updated_at) !== ts(l.updated_at)) || (l._dirty && ts(r.updated_at) > ts(l.updated_at))) {
      const { user_id, ...rest } = r;
      // un membre garde sa vitesse personnelle
      if (l && l.reglages && l.reglages.vitesse && !canEdit()) rest.reglages = Object.assign({}, rest.reglages, { vitesse: l.reglages.vitesse });
      map[r.id] = Object.assign(rest, { _dirty: false });
      changed = true;
    }
  }
  return changed;
}

async function pushDirty(table, map, fields) {
  const dirty = Object.values(map).filter(x => x._dirty && x.equipe_id === team.id);
  if (!dirty.length) return;
  const rows = dirty.map(x => { const o = {}; for (const f of fields) o[f] = x[f]; return o; });
  const { error } = await sb.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  for (const x of dirty) {
    const cur = map[x.id];
    if (cur && cur.updated_at === x.updated_at) cur._dirty = false;
  }
}

async function sync() {
  if (!sb || !session || !team.id || syncing || !navigator.onLine) return;
  syncing = true; setBanner('Synchronisation…');
  try {
    const [a, b] = await Promise.all([
      sb.from('prompteur_textes').select('*').eq('equipe_id', team.id),
      sb.from('prompteur_setlists').select('*').eq('equipe_id', team.id)
    ]);
    if (a.error) throw a.error; if (b.error) throw b.error;
    const c1 = mergeRemote(db.textes, a.data), c2 = mergeRemote(db.setlists, b.data);
    for (const t of Object.values(db.textes)) { t.reglages = t.reglages || {}; t.created_at = t.created_at || nowIso(); }
    for (const s of Object.values(db.setlists)) { s.texte_ids = s.texte_ids || []; s.created_at = s.created_at || nowIso(); }
    if (canEdit()) {
      await pushDirty('prompteur_textes', db.textes, ['id', 'equipe_id', 'titre', 'contenu', 'reglages', 'supprime', 'updated_at', 'created_at']);
      await pushDirty('prompteur_setlists', db.setlists, ['id', 'equipe_id', 'nom', 'texte_ids', 'supprime', 'updated_at', 'created_at']);
    }
    db.save();
    store.set('pr_lastsync', nowIso());
    setBanner(null);
    if ((c1 || c2) && visible('v-home')) renderHome();
    if (visible('v-account')) renderAccount();
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
window.addEventListener('online', () => { scheduleSync(500); if (session) connectTeam(); });

/* --- équipes --- */
async function loadTeams(retry = true) {
  if (!sb || !session) return;
  const { data, error } = await sb.from('prompteur_membres')
    .select('role, equipe_id, prompteur_equipes(id, nom, code_invitation)')
    .eq('user_id', session.user.id);
  if (error) { console.warn(error); return; }
  team.list = (data || []).filter(r => r.prompteur_equipes).map(r => ({
    id: r.equipe_id, nom: r.prompteur_equipes.nom, code_invitation: r.prompteur_equipes.code_invitation, role: r.role
  })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  // Nouveau compte : on lui crée son équipe dont il est l'admin.
  if (!team.list.length && retry && !store.get('pr_invite', null)) {
    const { error: e2 } = await sb.rpc('prompteur_creer_equipe', { p_nom: 'Mon équipe' });
    if (!e2) return loadTeams(false);
  }
  if (!team.current()) team.id = team.list.length ? team.list[0].id : null;
  team.save();
  adoptLocalItems();
}

// Les textes créés sans compte sur cet appareil rejoignent l'équipe (si on en est admin).
function adoptLocalItems() {
  if (!canEdit() || !team.id) return;
  let n = 0;
  for (const map of [db.textes, db.setlists]) {
    for (const x of Object.values(map)) {
      if (!x.equipe_id && x._dirty) { x.equipe_id = team.id; n++; }
    }
  }
  if (n) db.save();
}

async function loadMembers() {
  if (!sb || !session || !team.id) { team.members = []; return; }
  const { data, error } = await sb.from('prompteur_membres').select('user_id, role, email').eq('equipe_id', team.id);
  if (!error) team.members = (data || []).sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'admin' ? -1 : 1));
}

async function selectTeam(id) {
  team.id = id; team.save();
  adoptLocalItems();
  renderHome();
  connectTeam(true);
  await Promise.all([sync(), loadMembers()]);
  renderAccount();
}

/* ================= COMPTE & ÉQUIPE ================= */
$('#btn-account').onclick = () => openAccount();
async function openAccount() {
  renderAccount(); show('v-account');
  if (session) { await loadTeams(); await loadMembers(); renderAccount(); }
}

function renderAccount() {
  $('#acc-out').classList.toggle('hidden', !!session);
  $('#acc-in').classList.toggle('hidden', !session);
  setIcon($('#btn-account'), session ? 'users' : 'user');
  $('#btn-account').classList.toggle('on', !!session);
  $('#acc-import-btn').classList.toggle('hidden', !canEdit());
  if (!session) return;
  $('#acc-who').textContent = session.user.email;
  const l = store.get('pr_lastsync', null);
  $('#acc-last').textContent = l ? 'Dernière synchro : ' + new Date(l).toLocaleString('fr-FR') : '';

  const t = team.current();
  const sel = $('#team-select');
  sel.classList.toggle('hidden', team.list.length < 2);
  sel.innerHTML = team.list.map(x => `<option value="${x.id}" ${x.id === team.id ? 'selected' : ''}>${esc(x.nom)}${x.role === 'admin' ? ' (admin)' : ''}</option>`).join('');
  $('#team-card').classList.toggle('hidden', !t);
  if (!t) return;
  const admin = t.role === 'admin';
  const nameEl = $('#team-name');
  if (document.activeElement !== nameEl) nameEl.value = t.nom;
  nameEl.readOnly = !admin;
  const badge = $('#team-role');
  badge.textContent = admin ? 'Admin' : 'Membre';
  badge.classList.toggle('admin', admin);
  $('#team-admin').classList.toggle('hidden', !admin);
  $('#team-code').textContent = t.code_invitation || '';
  $('#team-member-note').textContent = admin
    ? 'Tu peux créer, modifier et supprimer les textes et setlists, et gérer les membres.'
    : 'Tu peux lire les textes, lancer le prompteur et utiliser la télécommande. Seuls les admins modifient.';
  $('#team-leave').classList.toggle('hidden', team.list.length < 2 && admin);

  const ul = $('#team-members'); ul.innerHTML = '';
  for (const m of team.members) {
    const me = m.user_id === session.user.id;
    const li = document.createElement('li');
    li.innerHTML = `${ic(m.role === 'admin' ? 'crown' : 'user')}<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div>`;
    li.querySelector('.li-title').textContent = m.email || 'Membre';
    li.querySelector('.li-sub').textContent = (m.role === 'admin' ? 'Admin' : 'Membre') + (me ? ' · toi' : '');
    if (admin && !me) {
      const roleBtn = document.createElement('button');
      roleBtn.className = 'li-small'; roleBtn.title = m.role === 'admin' ? 'Retirer les droits admin' : 'Nommer admin';
      roleBtn.setAttribute('aria-label', roleBtn.title);
      roleBtn.innerHTML = ic(m.role === 'admin' ? 'user' : 'crown');
      roleBtn.onclick = () => setRole(m, m.role === 'admin' ? 'membre' : 'admin');
      const rm = document.createElement('button');
      rm.className = 'li-small'; rm.setAttribute('aria-label', 'Retirer de l\'équipe'); rm.innerHTML = ic('x');
      rm.onclick = () => removeMember(m);
      li.append(roleBtn, rm);
    }
    ul.appendChild(li);
  }
}

const accMsg = (m) => { $('#acc-msg').textContent = m || ''; };
function frErr(e) {
  const m = (e && e.message) || String(e);
  if (/Invalid login/i.test(m)) return 'Email ou mot de passe incorrect.';
  if (/not confirmed/i.test(m)) return 'Confirme d\'abord ton email (regarde ta boîte mail), puis reconnecte-toi.';
  if (/already registered/i.test(m)) return 'Ce compte existe déjà : utilise « Se connecter ».';
  if (/Code invalide/i.test(m)) return 'Code d\'invitation inconnu. Vérifie-le auprès de ton admin.';
  if (/au moins un admin/i.test(m)) return 'Une équipe doit garder au moins un admin. Nomme d\'abord quelqu\'un d\'autre admin.';
  if (/fetch|network/i.test(m)) return 'Pas de connexion internet.';
  return m;
}
function creds() {
  if (!sb) { accMsg('La sauvegarde en ligne n\'est pas configurée. Tes textes restent sur cet appareil.'); return null; }
  const email = $('#acc-email').value.trim(), password = $('#acc-pass').value;
  if (!email || password.length < 6) { accMsg('Entre ton email et un mot de passe d\'au moins 6 caractères.'); return null; }
  return { email, password };
}
// Vrai formulaire : l'iPhone propose d'enregistrer le mot de passe et le remplit ensuite avec Face ID.
$('#acc-out').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = creds(); if (!c) return; accMsg('Connexion…');
  const { error } = await sb.auth.signInWithPassword(c);
  if (error) return accMsg(frErr(error));
  accMsg(isIOS && !isInstalled
    ? 'Connecté. Pour rester connecté, installe l\'appli sur l\'écran d\'accueil (Partager puis « Sur l\'écran d\'accueil ») et connecte-toi une fois dedans.'
    : 'Connecté. Tu resteras connecté sur cet appareil.');
  $('#acc-pass').value = '';
});
$('#acc-signup').onclick = async () => {
  const c = creds(); if (!c) return; accMsg('Création du compte…');
  const { data, error } = await sb.auth.signUp({ ...c, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) return accMsg(frErr(error));
  accMsg(data.session ? 'Compte créé et connecté.' : 'Compte créé ! Clique sur le lien reçu par email, puis reviens ici et connecte-toi.');
};
$('#acc-reset').onclick = async () => {
  if (!sb) return accMsg('La sauvegarde en ligne n\'est pas configurée.');
  const email = $('#acc-email').value.trim(); if (!email) return accMsg('Entre ton email ci-dessus.');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  accMsg(error ? frErr(error) : 'Email de réinitialisation envoyé.');
};
$('#acc-sync').onclick = async () => { accMsg('Synchronisation…'); await loadTeams(); await sync(); await loadMembers(); renderAccount(); renderHome(); accMsg(''); };
$('#acc-logout').onclick = async () => {
  const choice = await modal({
    title: 'Se déconnecter ?', icon: 'logout',
    message: 'Les textes de l\'équipe restent sauvegardés en ligne. Tu peux aussi les retirer de cet appareil.',
    buttons: [
      { label: 'Se déconnecter', value: 'keep', style: 'primary' },
      { label: 'Se déconnecter et effacer de cet appareil', value: 'wipe', style: 'secondary' },
      { label: 'Annuler', value: null, style: 'ghost' }
    ]
  });
  if (!choice) return;
  const wipe = choice === 'wipe';
  disconnectTeam();
  await sb.auth.signOut();
  if (wipe) {
    for (const map of [db.textes, db.setlists]) for (const [k, x] of Object.entries(map)) if (x.equipe_id) delete map[k];
    db.save();
  }
  team.list = []; team.id = null; team.members = []; team.save();
  renderAccount(); renderHome();
};

$('#team-select').addEventListener('change', (e) => selectTeam(e.target.value));
$('#team-name').addEventListener('change', async (e) => {
  const t = team.current(); const nom = e.target.value.trim();
  if (!t || t.role !== 'admin' || !nom || nom === t.nom) return;
  const { error } = await sb.from('prompteur_equipes').update({ nom }).eq('id', t.id);
  if (error) return accMsg(frErr(error));
  t.nom = nom; team.save(); renderHome(); accMsg('Nom de l\'équipe enregistré.');
});
$('#team-share').onclick = async () => {
  const t = team.current(); if (!t) return;
  const url = inviteUrl(t.code_invitation);
  const text = `Rejoins l'équipe « ${t.nom} » sur Prompteur. Ouvre ce lien (code d'invitation : ${t.code_invitation}) :`;
  try {
    if (navigator.share) await navigator.share({ title: 'Prompteur', text, url });
    else { await navigator.clipboard.writeText(text + ' ' + url); toast('Invitation copiée'); }
  } catch {}
};
$('#team-newcode').onclick = async () => {
  const t = team.current(); if (!t) return;
  if (!await confirmModal('Nouveau code d\'invitation ?', 'L\'ancien code ne fonctionnera plus. Les membres déjà dans l\'équipe ne sont pas concernés.', 'Créer un nouveau code', { icon: 'refresh' })) return;
  const { data, error } = await sb.rpc('prompteur_nouveau_code', { p_equipe: t.id });
  if (error) return accMsg(frErr(error));
  t.code_invitation = data; team.save(); renderAccount();
};
async function joinWithCode(code) {
  if (!session) return false;
  accMsg('Connexion à l\'équipe…');
  const { data, error } = await sb.rpc('prompteur_rejoindre', { p_code: code });
  if (error) { accMsg(frErr(error)); return false; }
  $('#join-code').value = '';
  await loadTeams(); await selectTeam(data);
  const nom = (team.current() || {}).nom || '';
  accMsg(`Tu as rejoint l'équipe « ${nom} ».`);
  toast(`Bienvenue dans l'équipe « ${nom} »`);
  return true;
}
$('#join-btn').onclick = () => {
  const code = $('#join-code').value.trim().toUpperCase();
  if (code.length < 4) return accMsg('Entre le code d\'invitation donné par ton admin.');
  joinWithCode(code);
};

/* --- lien d'invitation : …/?rejoindre=CODE --- */
function inviteUrl(code) { return location.origin + location.pathname + '?rejoindre=' + encodeURIComponent(code); }
(() => {
  const params = new URLSearchParams(location.search);
  const code = (params.get('rejoindre') || '').trim().toUpperCase();
  if (!code) return;
  store.set('pr_invite', code);
  params.delete('rejoindre');
  const q = params.toString();
  history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
})();

let inviteBusy = false;
async function handleInvite() {
  const code = store.get('pr_invite', null);
  if (!code || !sb || inviteBusy) return;
  inviteBusy = true;
  try {
    const { data: nom } = await sb.rpc('prompteur_apercu_equipe', { p_code: code });
    if (!nom) {
      store.set('pr_invite', null);
      await modal({ title: 'Invitation invalide', icon: 'x', danger: true,
        message: 'Ce lien d\'invitation n\'est plus valable. Demande un nouveau lien à l\'admin de l\'équipe.',
        buttons: [{ label: 'OK', value: true }] });
      return;
    }
    if (!session) {
      // pas encore connecté : le code est gardé et l'équipe sera rejointe après la connexion
      openAccount();
      const v = await modal({ title: `Rejoindre « ${nom} »`, icon: 'users',
        message: 'Connecte-toi ou crée ton compte : tu rejoindras l\'équipe automatiquement juste après.',
        buttons: [{ label: 'Continuer', value: 'go' }, { label: 'Annuler l\'invitation', value: 'cancel', style: 'ghost' }] });
      if (v === 'cancel') store.set('pr_invite', null);
      else setTimeout(() => $('#acc-email').focus(), 50);
      return;
    }
    await loadTeams();
    const deja = team.list.find(t => t.code_invitation === code);
    store.set('pr_invite', null);
    if (deja) {
      if (deja.id !== team.id) await selectTeam(deja.id);
      toast(`Tu fais déjà partie de « ${deja.nom} »`);
      return;
    }
    const ok = await modal({ title: `Rejoindre « ${nom} » ?`, icon: 'users',
      message: `Tu es connecté avec ${session.user.email}. Tu pourras lire les textes de l'équipe, lancer le prompteur et utiliser la télécommande.`,
      buttons: [{ label: 'Rejoindre l\'équipe', value: true }, { label: 'Plus tard', value: false, style: 'ghost' }] });
    if (ok) await joinWithCode(code);
    else { $('#join-code').value = code; }
  } finally { inviteBusy = false; }
}
$('#team-create').onclick = async () => {
  const nom = await promptModal('Nouvelle équipe', 'Tu en seras l\'admin. Tu pourras inviter tes musiciens avec son code.', 'Créer l\'équipe',
    { placeholder: 'Nom de l\'équipe (ex : Mon groupe)', icon: 'users', min: 1, minMsg: 'Donne un nom à l\'équipe' });
  if (!nom) return;
  const { data, error } = await sb.rpc('prompteur_creer_equipe', { p_nom: nom });
  if (error) return accMsg(frErr(error));
  await loadTeams(); await selectTeam(data);
  accMsg(`Équipe « ${nom} » créée. Tu en es l'admin.`);
};
$('#team-leave').onclick = async () => {
  const t = team.current(); if (!t) return;
  if (!await confirmModal('Quitter l\'équipe ?', `Tu n'auras plus accès aux textes de « ${t.nom} ». Il faudra un nouveau code pour revenir.`, 'Quitter l\'équipe', { danger: true, icon: 'logout' })) return;
  const { error } = await sb.from('prompteur_membres').delete().eq('equipe_id', t.id).eq('user_id', session.user.id);
  if (error) return accMsg(frErr(error));
  team.id = null; await loadTeams(); await selectTeam(team.id);
};
async function setRole(m, role) {
  const { error } = await sb.from('prompteur_membres').update({ role }).eq('equipe_id', team.id).eq('user_id', m.user_id);
  if (error) return accMsg(frErr(error));
  await loadMembers(); renderAccount();
}
async function removeMember(m) {
  if (!await confirmModal('Retirer ce membre ?', `${m.email || 'Ce membre'} n'aura plus accès aux textes de l'équipe.`, 'Retirer', { danger: true, icon: 'x' })) return;
  const { error } = await sb.from('prompteur_membres').delete().eq('equipe_id', team.id).eq('user_id', m.user_id);
  if (error) return accMsg(frErr(error));
  await loadMembers(); renderAccount();
}

if (sb) {
  sb.auth.onAuthStateChange((event, s) => {
    session = s;
    // la session restaurée au démarrage n'est pas transmise automatiquement au temps réel
    if (s) { try { sb.realtime.setAuth(s.access_token); } catch {} }
    if (event === 'PASSWORD_RECOVERY') {
      promptModal('Nouveau mot de passe', 'Choisis ton nouveau mot de passe (6 caractères minimum).', 'Enregistrer',
        { type: 'password', placeholder: 'Nouveau mot de passe', icon: 'user', min: 6, minMsg: '6 caractères minimum' })
        .then(p => p && sb.auth.updateUser({ password: p }).then(({ error }) => toast(error ? frErr(error) : 'Mot de passe modifié')));
    }
    if (s && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
      // hors du callback d'authentification pour ne pas bloquer le client
      setTimeout(async () => {
        await loadTeams();
        renderHome(); renderAccount();
        connectTeam();
        handleInvite();
        await sync();
        if (visible('v-account')) { await loadMembers(); renderAccount(); }
      }, 0);
    }
    if (!s && event === 'INITIAL_SESSION') setTimeout(handleInvite, 0);
    if (!s && event !== 'INITIAL_SESSION') disconnectTeam();
    renderAccount(); renderHome();
  });
}

/* --- sauvegarde fichier --- */
$('#acc-export').onclick = () => {
  const data = { app: 'prompteur', version: 2, date: nowIso(), textes: liveTextes(), setlists: liveSetlists() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `prompteur-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$('#acc-importfile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f || !canEdit()) return;
  try {
    const data = JSON.parse(await f.text());
    let n = 0;
    // nouveaux identifiants : l'import ajoute des copies dans l'équipe active
    const ids = {};
    for (const t of data.textes || []) {
      const id = uuid(); ids[t.id] = id;
      db.textes[id] = { id, equipe_id: scopeId(), titre: t.titre || '', contenu: t.contenu || '', reglages: t.reglages || {}, supprime: false, created_at: nowIso(), updated_at: nowIso(), _dirty: true }; n++;
    }
    for (const s of data.setlists || []) {
      const id = uuid();
      db.setlists[id] = { id, equipe_id: scopeId(), nom: s.nom || '', texte_ids: (s.texte_ids || []).map(x => ids[x]).filter(Boolean), supprime: false, created_at: nowIso(), updated_at: nowIso(), _dirty: true };
    }
    db.save(); scheduleSync(300);
    accMsg(`${n} texte(s) importé(s).`);
  } catch { accMsg('Fichier de sauvegarde invalide.'); }
  e.target.value = '';
});

/* ================= TÉLÉCOMMANDE (Supabase Realtime, canal privé de l'équipe) ================= */
const TC = { ch: null, teamId: null, ready: false, devices: {} };
const RC = { target: null, last: null, lastSeen: 0, tab: 'setlists', states: {} };

function connectTeam(force) {
  if (!sb || !session || !team.id) return;
  if (TC.ch && TC.teamId === team.id && !force) return;
  disconnectTeam();
  TC.teamId = team.id;
  const ch = sb.channel('prompteur:' + team.id, {
    config: { private: true, broadcast: { self: false } }
  });
  TC.ch = ch;
  ch.on('broadcast', { event: 'cmd' }, ({ payload }) => {
    if (payload && payload.to === prefs.deviceId) remoteCommand(payload);
  });
  ch.on('broadcast', { event: 'ping' }, ({ payload }) => {
    if (!payload || !payload.to || payload.to === prefs.deviceId) sendState(true);
  });
  ch.on('broadcast', { event: 'state' }, ({ payload }) => {
    if (!payload || !payload.from) return;
    // on garde le dernier état de chaque appareil (liste et télécommande)
    RC.states[payload.from] = Object.assign({}, payload, { at: Date.now() });
    if (payload.from === RC.target) { RC.last = payload; RC.lastSeen = Date.now(); }
    renderRemote();
  });
  ch.subscribe((status) => {
    if (ch !== TC.ch) return;
    TC.ready = status === 'SUBSCRIBED';
    if (TC.ready) {
      TC.retry = 0;
      sendState();
      ping(RC.target || null);
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      console.warn('Canal équipe :', status);
      // reconnexion automatique, de plus en plus espacée (max 30 s)
      const wait = Math.min(30000, 2000 * Math.pow(2, TC.retry || 0));
      TC.retry = (TC.retry || 0) + 1;
      clearTimeout(TC.retryTimer);
      TC.retryTimer = setTimeout(() => { TC.retryTimer = 0; if (ch === TC.ch) connectTeam(true); }, wait);
    }
    renderRemote();
  });
}
function teamChannelOk() { return !!TC.ch && TC.ready && TC.ch.state === 'joined'; }
function disconnectTeam() {
  const ch = TC.ch;
  TC.ch = null; TC.ready = false; TC.teamId = null;
  clearTimeout(TC.retryTimer); TC.retryTimer = 0;
  if (ch) { try { sb.removeChannel(ch); } catch {} }
}

// Commande reçue d'une télécommande de l'équipe.
async function remoteCommand(c) {
  const a = c.a;
  if (a === 'open') {
    // ouvrir un texte ou une setlist à distance, puis lancer le compte à rebours
    let ids = Array.isArray(c.ids) ? c.ids : [];
    if (ids.some(id => !db.textes[id])) await sync();   // texte ajouté depuis la dernière synchro
    ids = ids.filter(id => db.textes[id] && !db.textes[id].supprime);
    if (!ids.length) { toast('Texte introuvable sur cet appareil'); sendState(true); return; }
    if (modalResolve) modalResolve(null);
    $('#picker').classList.add('hidden');
    closeSettings();
    if (visible('v-edit')) flushEdit();
    if (P.open) pause();
    startPrompter(ids, clamp(+c.i || 0, 0, ids.length - 1));
    toast('Lancé depuis la télécommande');
    setTimeout(play, 100);
    return;
  }
  if (!P.open) { sendState(true); return; }
  if (a === 'toggle') toggle();
  else if (a === 'speed+') changeSpeed(1);
  else if (a === 'speed-') changeSpeed(-1);
  else if (a === 'fwd') nudge(0.35);
  else if (a === 'back') nudge(-0.35);
  else if (a === 'top') { pause(); setPos(0); }
  else if (a === 'next') goSong(P.idx + 1);
  else if (a === 'prev') goSong(P.idx - 1);
  else if (a === 'goto') goSong(+c.i);
  else if (a === 'close') { closePrompter(); sendState(true); return; }
  sendState(true);
}

// Chaque appareil connecté s'annonce à l'équipe par un message « state » régulier (toutes les
// 2,5 s, et à chaque changement) : il apparaît dans la télécommande et peut recevoir un texte.
// On n'utilise pas la « présence » Supabase, trop limitée en débit : elle coupait l'appareil.
const ONLINE_MS = 9000;
function trackPresence() { sendState(); }
function untrackPresence() { sendState(); }
setInterval(() => sendState(), 2500);
function liveDevices() {
  const now = Date.now();
  return Object.entries(RC.states).filter(([k, st]) => k !== prefs.deviceId && now - st.at < ONLINE_MS);
}

// État envoyé aux télécommandes : au plus un message toutes les 250 ms (le dernier part toujours).
let lastStateSend = 0, stateTimer = 0;
function sendState() {
  if (!TC.ready) return;
  const wait = 250 - (Date.now() - lastStateSend);
  if (wait > 0) { clearTimeout(stateTimer); stateTimer = setTimeout(sendState, wait); return; }
  if (!teamChannelOk()) return;
  lastStateSend = Date.now();
  if (!P.open) {
    TC.ch.send({ type: 'broadcast', event: 'state', payload: { from: prefs.deviceId, nom: prefs.deviceName, open: false } });
    return;
  }
  const t = curTexte();
  const m = maxPos();
  TC.ch.send({
    type: 'broadcast', event: 'state',
    payload: {
      from: prefs.deviceId, nom: prefs.deviceName, open: true,
      titre: t ? (t.titre || 'Sans titre') : '', idx: P.idx, n: P.queue.length,
      playing: P.playing || P.counting, speed: P.speed, prog: m ? P.pos / m : 0,
      songs: P.queue.map(id => (db.textes[id] && db.textes[id].titre) || 'Sans titre')
    }
  });
}

/* côté téléphone télécommande */
$('#btn-remote').onclick = () => {
  RC.target = null; RC.last = null;
  show('v-remote');
  connectTeam();
  renderRemote();
  scheduleSync(300);
};
$('#rc-login').onclick = () => openAccount();
$('#rc-other').onclick = () => { RC.target = null; RC.last = null; renderRemote(); };
$$('#rc-launch-tabs button').forEach(b => b.onclick = () => {
  RC.tab = b.dataset.v;
  $$('#rc-launch-tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#rc-library').dataset.key = '';
  renderRemote();
});

function ping(to) { if (TC.ready) TC.ch.send({ type: 'broadcast', event: 'ping', payload: { to } }); }
function rcSend(a, extra) {
  if (!TC.ready || !RC.target) return toast('Télécommande non connectée');
  TC.ch.send({ type: 'broadcast', event: 'cmd', payload: Object.assign({ to: RC.target, a }, extra) });
  if (navigator.vibrate) navigator.vibrate(15);
}
$('#rc-play').onclick = () => rcSend('toggle');
$$('[data-rc]').forEach(b => b.onclick = () => rcSend(b.dataset.rc));

function renderLibrary() {
  const ul = $('#rc-library');
  const items = RC.tab === 'setlists'
    ? liveSetlists().sort((a, b) => ts(b.updated_at) - ts(a.updated_at))
        .map(s => ({ ids: setlistIds(s), titre: s.nom || 'Setlist sans nom' }))
        .filter(x => x.ids.length)
        .map(x => ({ ...x, sub: `${x.ids.length} morceau${x.ids.length > 1 ? 'x' : ''}` }))
    : liveTextes().sort((a, b) => (a.titre || '').localeCompare(b.titre || '', 'fr'))
        .map(t => ({ ids: [t.id], titre: t.titre || 'Sans titre', sub: firstLine(t.contenu) }));
  const key = RC.tab + JSON.stringify(items.map(x => [x.titre, x.ids]));
  if (ul.dataset.key === key) return;
  ul.dataset.key = key; ul.innerHTML = '';
  if (!items.length) {
    ul.innerHTML = `<p class="empty">${RC.tab === 'setlists' ? 'Aucune setlist dans l\'équipe.' : 'Aucun texte dans l\'équipe.'}</p>`;
    return;
  }
  for (const x of items) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div><span class="li-play">${ic('play')}</span>`;
    li.querySelector('.li-title').textContent = x.titre;
    li.querySelector('.li-sub').textContent = x.sub || '';
    li.onclick = () => {
      rcSend('open', { ids: x.ids, i: 0 });
      const d = RC.states[RC.target] || {};
      toast(`Lancement sur ${d.nom || 'l\'appareil'}…`);
    };
    ul.appendChild(li);
  }
}

let rcShownPlaying = null;
function renderRemote() {
  if (!visible('v-remote')) return;
  const logged = !!session && !!team.id;
  const t = team.current();
  $('#rc-login').classList.toggle('hidden', logged);
  if (!logged) {
    $('#rc-pad').classList.add('hidden'); $('#rc-list-view').classList.remove('hidden');
    $('#rc-intro').textContent = 'La télécommande fonctionne avec ton équipe : connecte-toi sur ce téléphone et sur l\'appareil de scène avec des comptes de la même équipe.';
    $('#rc-devices').innerHTML = ''; $('#rc-none').classList.add('hidden');
    return;
  }
  // une coupure passagère ne fait pas perdre l'appareil choisi : on affiche « reconnexion »
  const lost = RC.target && (!teamChannelOk() || Date.now() - RC.lastSeen > ONLINE_MS);
  if (!RC.target) {
    $('#rc-pad').classList.add('hidden'); $('#rc-list-view').classList.remove('hidden');
    $('#rc-intro').textContent = TC.ready
      ? `Appareils de l'équipe « ${t ? t.nom : ''} ». Choisis celui à piloter.`
      : 'Connexion à l\'équipe…';
    const ul = $('#rc-devices'); ul.innerHTML = '';
    // les prompteurs ouverts d'abord
    const entries = liveDevices().sort((a, b) => (b[1].open ? 1 : 0) - (a[1].open ? 1 : 0));
    for (const [key, d] of entries) {
      const li = document.createElement('li');
      li.innerHTML = `${ic('screen')}<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div><span class="dot ${d.playing ? '' : 'off'}"></span>${ic('chevron')}`;
      li.querySelector('.li-title').textContent = d.nom || 'Appareil';
      li.querySelector('.li-sub').textContent = d.open
        ? (d.titre || '') + (d.playing ? ' · en lecture' : ' · en pause')
        : 'Prêt : tu peux y lancer un texte';
      li.onclick = () => { RC.target = key; RC.last = RC.states[key] || null; RC.lastSeen = Date.now(); ping(key); renderRemote(); };
      ul.appendChild(li);
    }
    $('#rc-none').classList.toggle('hidden', !TC.ready || entries.length > 0);
    return;
  }
  $('#rc-list-view').classList.add('hidden'); $('#rc-pad').classList.remove('hidden');
  const s = RC.last;
  const d = s || {};
  const open = !!(s && s.open);
  $('#rc-device').innerHTML = ic('screen') + esc((s && s.nom) || d.nom || 'Appareil') +
    (lost ? ' <span class="rc-lost">· reconnexion…</span>' : '');
  $('#rc-controls').classList.toggle('hidden', !open);
  $('#rc-launch-title').textContent = open ? 'Lancer autre chose' : 'Lancer sur cet appareil';
  $('#rc-launch-hint').textContent = open
    ? 'Remplace le texte affiché et relance le compte à rebours.'
    : 'Le prompteur s\'ouvre sur l\'appareil et le compte à rebours démarre.';
  renderLibrary();
  if (!open) {
    $('#rc-title').textContent = 'Prêt';
    $('#rc-sub').textContent = 'Aucun texte ouvert. Choisis ci-dessous ce que tu veux lancer.';
    $('#rc-prog').style.width = '0%';
    return;
  }
  if (!s) {
    $('#rc-title').textContent = d.titre || 'Connexion au prompteur…';
    $('#rc-sub').textContent = '';
    return;
  }
  $('#rc-title').textContent = s.titre;
  $('#rc-sub').textContent = (s.n > 1 ? `Morceau ${s.idx + 1}/${s.n} · ` : '') + (s.playing ? 'Défilement en cours' : 'En pause');
  $('#rc-prog').style.width = (s.prog * 100) + '%';
  if (s.playing !== rcShownPlaying) { setIcon($('#rc-play'), s.playing ? 'pause' : 'play'); rcShownPlaying = s.playing; }
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
// La télécommande demande l'état régulièrement : ça maintient le lien et détecte les coupures.
setInterval(() => {
  if (!visible('v-remote')) return;
  if (TC.ch && !teamChannelOk() && !TC.retryTimer) connectTeam(true);
  ping(RC.target || null);
  renderRemote();
}, 3000);

/* ================= DÉMARRAGE ================= */
if (!Object.keys(db.textes).length && !store.get('pr_welcomed', false)) {
  const t = {
    id: uuid(), titre: 'Exemple – Mode d\'emploi', reglages: {}, supprime: false, created_at: nowIso(), equipe_id: null,
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
Pilote le défilement depuis un deuxième téléphone
ou avec une pédale Bluetooth.

# Refrain
Et voilà, c'est à toi !
[Fin]`
  };
  t.updated_at = nowIso();
  db.textes[t.id] = t; db.save(); store.set('pr_welcomed', true);
}
renderHome();
renderAccount();

/* ================= MODE D'EMPLOI ================= */
const DEMO_ID = 'demo-mode-emploi';
$('#btn-help').onclick = () => show('v-help');
$('#help-example').onclick = () => {
  // texte d'essai gardé hors des listes et jamais synchronisé
  db.textes[DEMO_ID] = {
    id: DEMO_ID, equipe_id: '__demo__', titre: 'Essai du prompteur', reglages: {}, supprime: false,
    created_at: nowIso(), updated_at: nowIso(),
    contenu: `# Essai
Touche l'écran pour mettre en pause,
touche encore pour reprendre.

Glisse le doigt vers le haut ou le bas
pour avancer ou reculer.

# Vitesse
Utilise les boutons moins et plus
en bas de l'écran.
[Les réglages sont en haut à droite]

# Refrain
Tu es prêt pour la scène.
[Fin de l'essai]`
  };
  startPrompter([DEMO_ID], 0);
  setTimeout(play, 150);
};
// Première ouverture : on propose la notice (sauf si on arrive par un lien d'invitation).
if (!store.get('pr_notice_vu', false)) {
  store.set('pr_notice_vu', true);
  setTimeout(() => {
    if (store.get('pr_invite', null) || modalResolve) return;
    modal({
      title: 'Bienvenue sur Prompteur', icon: 'help',
      message: 'Ton texte défile tout seul pendant que tu chantes ou que tu parles. Jette un œil au mode d\'emploi pour démarrer en 2 minutes.',
      buttons: [{ label: 'Lire le mode d\'emploi', value: true }, { label: 'Plus tard', value: false, style: 'ghost' }]
    }).then(v => { if (v) show('v-help'); });
  }, 700);
}

/* ================= MÉMOIRE DE L'APPAREIL ================= */
// Sur iPhone, Safari en navigation privée ou avec « Bloquer tous les cookies » n'enregistre rien :
// la connexion et les textes sont perdus au rechargement. On le détecte et on explique quoi faire.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isInstalled = navigator.standalone === true ||
  ['standalone', 'fullscreen'].some(m => window.matchMedia && window.matchMedia(`(display-mode: ${m})`).matches);
function storageWorks() {
  try { localStorage.setItem('pr_test', '1'); const ok = localStorage.getItem('pr_test') === '1'; localStorage.removeItem('pr_test'); return ok; }
  catch { return false; }
}
if (!storageWorks()) {
  setTimeout(() => modal({
    title: 'Ton navigateur n\'enregistre rien', icon: 'x', danger: true,
    message: 'Tu devras te reconnecter à chaque fois et tes textes ne seront pas gardés. Sur iPhone : quitte la navigation privée, ou va dans Réglages > Apps > Safari et désactive « Bloquer tous les cookies ». Puis installe l\'appli sur l\'écran d\'accueil.',
    buttons: [{ label: 'J\'ai compris', value: true }]
  }), 900);
}
// Dans Safari (pas l'appli installée), on rappelle d'installer l'appli : c'est elle qui garde la connexion.
function renderInstallBanner() {
  let closed = false;
  try { closed = sessionStorage.getItem('pr_install_closed') === '1'; } catch {}
  $('#install-banner').classList.toggle('hidden', !isIOS || isInstalled || closed);
}
$('#install-close').onclick = () => {
  try { sessionStorage.setItem('pr_install_closed', '1'); } catch {}
  renderInstallBanner();
};
renderInstallBanner();

// Demande à l'appareil de ne jamais effacer les données de l'appli (session, textes hors ligne).
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
})();
