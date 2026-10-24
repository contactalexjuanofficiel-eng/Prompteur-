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
  showguide: true, autonext: false, deviceId: uuid(), deviceName: guessDevice(),
  mode: 'scroll', chords: true, fit: true, timer: false
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
  const el = $('#modal'), acts = $('#modal-actions');
  $('#modal-input').classList.add('hidden'); $('#modal-textarea').classList.add('hidden');
  const inp = input && input.multiline ? $('#modal-textarea') : $('#modal-input');
  const ico = $('#modal-icon');
  ico.classList.toggle('hidden', !icon);
  ico.classList.toggle('danger', danger);
  if (icon) ico.innerHTML = ic(icon);
  $('#modal-title').textContent = title;
  $('#modal-msg').textContent = message;
  $('#modal-msg').classList.toggle('hidden', !message);
  $('#modal-msg').classList.toggle('long', message.includes('\n'));
  inp.classList.toggle('hidden', !input);
  if (input) {
    if (!input.multiline) inp.type = input.type || 'text';
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
    if (input) setTimeout(() => { inp.focus(); if (!input.multiline) inp.select(); }, 30);
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
  $('#btn-import').classList.toggle('hidden', !edit);

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
  // les notes « // » sont réservées aux admins : un membre ne les voit pas
  $('#edit-contenu').value = t ? (edit ? t.contenu : t.contenu.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')) : '';
  $('#edit-titre').readOnly = $('#edit-contenu').readOnly = $('#edit-duree').readOnly = !edit;
  $('#edit-duree').value = t && t.reglages && t.reglages.duree ? fmtTime(t.reglages.duree) : '';
  $('#edit-ro').classList.toggle('hidden', edit);
  $('#edit-import-btn').classList.toggle('hidden', !edit);
  $('#edit-delete').classList.toggle('hidden', !t || !edit);
  $('#edit-history').classList.toggle('hidden', !t || !edit || !session);
  updateStats();
  show('v-edit');
  if (!t && edit) $('#edit-titre').focus();
}
function updateStats() {
  const c = $('#edit-contenu').value;
  const words = (c.match(/\S+/g) || []).length;
  $('#edit-stats').textContent = `${words} mot${words > 1 ? 's' : ''}`;
}
// « 3:40 », « 3m40 », « 220 » (secondes) → secondes
function parseDuree(v) {
  v = (v || '').trim();
  if (!v) return 0;
  const m = v.match(/^(\d{1,3})\s*[:.hm'’ ]\s*(\d{1,2})\s*s?$/i);
  if (m) return +m[1] * 60 + +m[2];
  if (/^\d+$/.test(v)) return +v >= 20 ? +v : +v * 60;   // « 4 » = 4 minutes, « 220 » = 220 s
  return 0;
}
function flushEdit() {
  clearTimeout(editTimer);
  let t = editId ? db.textes[editId] : null;
  if (!canEdit()) return t;
  const titre = $('#edit-titre').value, contenu = $('#edit-contenu').value;
  const d = parseDuree($('#edit-duree').value);
  if (!t) {
    if (!titre.trim() && !contenu.trim()) return null;
    t = { id: uuid(), titre: '', contenu: '', reglages: {}, supprime: false, created_at: nowIso(), equipe_id: scopeId() };
    db.textes[t.id] = t; editId = t.id;
    $('#edit-delete').classList.remove('hidden');
  }
  const oldD = (t.reglages && +t.reglages.duree) || 0;
  if (t.titre !== titre || t.contenu !== contenu || oldD !== d) {
    t.titre = titre; t.contenu = contenu;
    t.reglages = Object.assign({}, t.reglages);
    if (d) t.reglages.duree = d; else delete t.reglages.duree;
    touchTexte(t);
  }
  return t;
}
$('#edit-duree').addEventListener('blur', () => {
  const d = parseDuree($('#edit-duree').value);
  if ($('#edit-duree').value.trim() && !d) return toast('Durée non reconnue (ex : 3:40)');
  $('#edit-duree').value = d ? fmtTime(d) : '';
});
['#edit-titre', '#edit-contenu', '#edit-duree'].forEach(s => $(s).addEventListener('input', () => {
  updateStats(); clearTimeout(editTimer); editTimer = setTimeout(flushEdit, 500);
}));
$('#edit-import').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  let txt;
  try { txt = await readFileText(f); } catch (err) { e.target.value = ''; return toast(err.message || 'Fichier illisible'); }
  const area = $('#edit-contenu');
  area.value = area.value ? area.value + '\n\n' + txt : txt;
  if (!$('#edit-titre').value) $('#edit-titre').value = f.name.replace(/\.[^.]+$/, '');
  e.target.value = ''; updateStats(); flushEdit();
});
/* --- historique des versions (admins) --- */
$('#edit-history').onclick = async () => {
  const t = editId && db.textes[editId];
  if (!t || !sb || !session) return;
  flushEdit(); await sync();
  const ul = $('#hist-list');
  ul.innerHTML = '<p class="empty">Chargement…</p>';
  $('#hist-sheet').classList.remove('hidden');
  const { data, error } = await sb.from('prompteur_versions')
    .select('id, titre, contenu, reglages, supprime, auteur_email, version_du, created_at')
    .eq('texte_id', t.id).order('created_at', { ascending: false }).limit(50);
  if (error) { ul.innerHTML = `<p class="empty">${esc(frErr(error))}</p>`; return; }
  ul.innerHTML = '';
  if (!data.length) { ul.innerHTML = '<p class="empty">Pas encore d\'ancienne version. Elles apparaissent ici dès que le texte est modifié.</p>'; return; }
  for (const v of data) {
    const li = document.createElement('li');
    const quand = new Date(v.version_du || v.created_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    li.innerHTML = `${ic('clock')}<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div>${ic('chevron')}`;
    li.querySelector('.li-title').textContent = quand;
    li.querySelector('.li-sub').textContent = (v.auteur_email ? 'par ' + v.auteur_email : 'avant l\'historique') + ' · ' + (firstLine(v.contenu) || v.titre || 'vide');
    li.onclick = async () => {
      const apercu = v.contenu.length > 600 ? v.contenu.slice(0, 600) + '\n…' : v.contenu;
      const ok = await modal({
        title: 'Restaurer cette version ?', icon: 'clock',
        message: `« ${v.titre || 'Sans titre'} » du ${quand}\n\n${apercu || '(texte vide)'}`,
        buttons: [{ label: 'Restaurer cette version', value: true }, { label: 'Annuler', value: false, style: 'ghost' }]
      });
      if (!ok) return;
      t.titre = v.titre; t.contenu = v.contenu; t.supprime = false;
      t.reglages = Object.assign({}, t.reglages, v.reglages || {});
      touchTexte(t);
      $('#hist-sheet').classList.add('hidden');
      openEdit(t.id);
      toast('Version restaurée. La version d\'avant reste dans l\'historique.');
    };
    ul.appendChild(li);
  }
};
$('#hist-done').onclick = () => $('#hist-sheet').classList.add('hidden');
$('#hist-sheet').addEventListener('click', (e) => { if (e.target.id === 'hist-sheet') $('#hist-sheet').classList.add('hidden'); });

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

/* ================= IMPORT (fichiers .txt / Word / PDF, ou texte collé) ================= */
const baseName = (n) => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
const SEP_RE = /^\s*-{3,}\s*$/m;

// « Titre\ntexte\n---\nTitre 2\ntexte… » → [{titre, contenu}]
function splitTexts(raw, fallbackTitle) {
  const txt = (raw || '').replace(/\r\n?/g, '\n');
  if (!SEP_RE.test(txt) && fallbackTitle) return txt.trim() ? [{ titre: fallbackTitle, contenu: txt.trim() }] : [];
  return txt.split(/^\s*-{3,}\s*$/m).map(b => b.replace(/^\n+|\n+$/g, '')).filter(b => b.trim()).map(b => {
    const lines = b.split('\n');
    const i = lines.findIndex(l => l.trim());
    const titre = lines[i].replace(/^\s*#+\s*/, '').trim().slice(0, 120);
    return { titre, contenu: lines.slice(i + 1).join('\n').replace(/^\n+/, '').trim() };
  });
}

// Lecture d'un fichier Word (.docx) : c'est un zip, on y lit word/document.xml.
async function inflateRaw(bytes) {
  if (!('DecompressionStream' in window)) throw new Error('Ton navigateur ne sait pas lire les fichiers Word. Mets à jour ton téléphone ou copie-colle le texte.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function docxText(buf) {
  const b = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Fichier Word illisible');
  let p = dv.getUint32(eocd + 16, true);
  const n = dv.getUint16(eocd + 10, true);
  let entry = null;
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    if (name === 'word/document.xml') { entry = { method, csize, off }; break; }
    p += 46 + nlen + xlen + clen;
  }
  if (!entry) throw new Error('Ce fichier Word ne contient pas de texte');
  const lh = entry.off, start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  const data = b.subarray(start, start + entry.csize);
  const xml = new TextDecoder().decode(entry.method === 8 ? await inflateRaw(data) : data);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const out = [];
  for (const para of doc.getElementsByTagNameNS(W, 'p')) {
    let line = '';
    for (const node of para.getElementsByTagNameNS(W, '*')) {
      if (node.localName === 't') line += node.textContent;
      else if (node.localName === 'tab') line += ' ';
      else if (node.localName === 'br' || node.localName === 'cr') line += '\n';
    }
    out.push(line);
  }
  return out.join('\n');
}

// Lecture d'un PDF avec pdf.js (chargé seulement quand on en a besoin).
let pdfLib = null;
function loadPdfLib() {
  if (pdfLib) return pdfLib;
  pdfLib = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/pdfjs/pdf.min.js';
    sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; resolve(window.pdfjsLib); };
    sc.onerror = () => { pdfLib = null; reject(new Error('Lecture des PDF indisponible (pas de connexion ?)')); };
    document.head.appendChild(sc);
  });
  return pdfLib;
}
async function pdfText(buf) {
  const lib = await loadPdfLib();
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let txt = '';
    for (const it of tc.items) { txt += it.str; if (it.hasEOL) txt += '\n'; }
    pages.push(txt.replace(/[ \t]+\n/g, '\n').trim());
  }
  const all = pages.join('\n\n').trim();
  if (!all) throw new Error('Ce PDF ne contient pas de texte (c\'est peut-être une image scannée)');
  return all;
}
async function readFileText(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (ext === 'docx') return docxText(await f.arrayBuffer());
  if (ext === 'pdf') return pdfText(await f.arrayBuffer());
  if (ext === 'doc') throw new Error('Ancien format Word (.doc) : enregistre-le en .docx');
  return f.text();
}

let impFiles = [];
function impAll() { return impFiles.concat(splitTexts($('#imp-paste').value, null)); }
function renderImport() {
  const items = impAll();
  const ul = $('#imp-list'); ul.innerHTML = '';
  items.forEach(x => {
    const li = document.createElement('li');
    li.innerHTML = `${ic('file')}<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div>`;
    li.querySelector('.li-title').textContent = x.titre || 'Sans titre';
    const n = x.contenu.split('\n').filter(l => l.trim()).length;
    li.querySelector('.li-sub').textContent = `${n} ligne${n > 1 ? 's' : ''} · ` + (firstLine(x.contenu) || 'vide');
    ul.appendChild(li);
  });
  $('#imp-go').disabled = !items.length;
  $('#imp-go').textContent = items.length ? `Importer ${items.length} texte${items.length > 1 ? 's' : ''}` : 'Importer';
  $('#imp-sl-row').classList.toggle('hidden', items.length < 2);
}
$('#btn-import').onclick = () => {
  if (!canEdit()) return;
  impFiles = []; $('#imp-paste').value = ''; $('#imp-msg').textContent = ''; $('#imp-setlist').checked = false;
  renderImport();
  $('#import-sheet').classList.remove('hidden');
};
$('#imp-close').onclick = () => $('#import-sheet').classList.add('hidden');
$('#import-sheet').addEventListener('click', (e) => { if (e.target.id === 'import-sheet') $('#import-sheet').classList.add('hidden'); });
$('#imp-paste').addEventListener('input', renderImport);
$('#imp-files').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files); e.target.value = '';
  const errs = [];
  $('#imp-msg').textContent = 'Lecture des fichiers…';
  for (const f of files) {
    try { impFiles.push(...splitTexts(await readFileText(f), baseName(f.name))); }
    catch (err) { errs.push(`${f.name} : ${err.message || 'illisible'}`); }
  }
  $('#imp-msg').textContent = errs.join('\n');
  renderImport();
});
$('#imp-go').onclick = () => {
  const items = impAll(); if (!items.length || !canEdit()) return;
  const ids = [];
  for (const x of items) {
    const t = { id: uuid(), equipe_id: scopeId(), titre: x.titre, contenu: x.contenu, reglages: {}, supprime: false, created_at: nowIso() };
    db.textes[t.id] = t; t.updated_at = nowIso(); t._dirty = true; ids.push(t.id);
  }
  if ($('#imp-setlist').checked && ids.length > 1) {
    const sl = { id: uuid(), equipe_id: scopeId(), nom: 'Import du ' + new Date().toLocaleDateString('fr-FR'), texte_ids: ids, supprime: false, created_at: nowIso() };
    db.setlists[sl.id] = sl; sl.updated_at = nowIso(); sl._dirty = true;
  }
  db.save(); scheduleSync(300);
  $('#import-sheet').classList.add('hidden');
  renderHome();
  toast(`${ids.length} texte${ids.length > 1 ? 's' : ''} importé${ids.length > 1 ? 's' : ''}`);
};

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
  speed: prefs.speed, uiTimer: 0, counting: false, countTimer: 0, autoTimer: 0, saveTimers: {},
  vel: 0, wake: null, open: false,
  transpo: 0, fit: false, elapsed: 0, li: 0, lines: [], steps: [], sections: [], totalWords: 1, hasCh: false
};
const pScroll = $('#p-scroll'), pText = $('#p-text'), pUi = $('#p-ui'), pLines = $('#p-lines');

/* --- accords et transposition --- */
const ROOT = '(Do|Ré|Re|Mi|Fa|Sol|La|Si|[A-G])([#b♯♭]?)';
const CHORD_RE = new RegExp(`^${ROOT}((?:m|min|maj|M|dim|aug|sus|add|°|ø|\\+|-|#|b|\\d|\\(|\\))*)(?:\\/${ROOT})?$`);
const NOTES = {
  en: { sharp: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], flat: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'],
        usual: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] },
  fr: { sharp: ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'], flat: ['Do', 'Réb', 'Ré', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'],
        usual: ['Do', 'Do#', 'Ré', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Lab', 'La', 'Sib', 'Si'] }
};
const BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, Do: 0, 'Ré': 2, Re: 2, Mi: 4, Fa: 5, Sol: 7, La: 9, Si: 11 };
function isChord(txt) { return CHORD_RE.test(txt.trim()); }
function shiftNote(root, acc, n) {
  const fr = !/^[A-G]$/.test(root);
  let i = BASE[root] + (acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0);
  i = (((i + n) % 12) + 12) % 12;
  // on garde l'écriture d'origine (# ou b) ; sinon l'usage courant : Bb, Eb, Ab mais F#, C#
  const kind = (acc === 'b' || acc === '♭') ? 'flat' : (acc === '#' || acc === '♯') ? 'sharp' : 'usual';
  const table = NOTES[fr ? 'fr' : 'en'][kind];
  return table[i];
}
function transposeChord(ch, n) {
  const m = ch.trim().match(CHORD_RE);
  if (!m || !n) return ch.trim();
  let out = shiftNote(m[1], m[2], n) + m[3];
  if (m[4]) out += '/' + shiftNote(m[4], m[5], n);
  return out;
}

// Une ligne de texte : accords [Am] au-dessus des mots, indications [Guitare seule] en couleur.
function renderLine(line, o) {
  const parts = [];             // {t:'txt'|'chord'|'cue', v}
  let last = 0;
  line.replace(/\[([^\]\n]*)\]/g, (all, inner, idx) => {
    if (idx > last) parts.push({ t: 'txt', v: line.slice(last, idx) });
    parts.push({ t: isChord(inner) ? 'chord' : 'cue', v: inner });
    last = idx + all.length;
  });
  if (last < line.length) parts.push({ t: 'txt', v: line.slice(last) });
  const chords = parts.filter(x => x.t === 'chord');
  const words = parts.filter(x => x.t === 'txt').map(x => x.v).join('').trim();
  const cue = (v) => `<span class="cue">[${esc(v)}]</span>`;
  if (!chords.length || !o.chords) {
    const html = parts.filter(x => x.t !== 'chord').map(x => x.t === 'cue' ? cue(x.v) : esc(x.v)).join('');
    return { html: `<span class="ln">${html.trim() ? html : ' '}</span>`, words, empty: !html.trim() };
  }
  // ligne composée uniquement d'accords (intro, pont instrumental…)
  if (!words) {
    const html = parts.map(x => x.t === 'chord' ? `<span class="ch-inline">${esc(transposeChord(x.v, o.transpo))}</span>` : x.t === 'cue' ? cue(x.v) : ' ').join(' ');
    return { html: `<span class="ln chline">${html}</span>`, words: '', empty: false };
  }
  // chaque accord est collé au mot qui le suit : il reste au-dessus de ce mot même si la ligne est coupée
  let html = '', pending = null;
  const block = (ch, word) => `<span class="cw"><span class="ch">${esc(transposeChord(ch, o.transpo))}</span>${word ? esc(word) : '&nbsp;'}</span>`;
  for (const x of parts) {
    if (x.t === 'chord') {
      if (pending !== null) html += block(pending, '') + ' ';
      pending = x.v;
    } else if (x.t === 'txt' && pending !== null) {
      const m = x.v.match(/^(\S*)([\s\S]*)$/);
      html += block(pending, m[1]) + esc(m[2]);
      pending = null;
    } else {
      if (pending !== null) { html += block(pending, '') + ' '; pending = null; }
      html += x.t === 'cue' ? cue(x.v) : esc(x.v);
    }
  }
  if (pending !== null) html += block(pending, '');
  return { html: `<span class="ln has-ch">${html}</span>`, words, empty: false };
}

// Texte complet → lignes. « # Refrain » = section, « // note » = note visible des admins seulement.
function parseText(s, o) {
  const out = [];
  for (const line of (s || '').split('\n')) {
    if (/^\s*\/\//.test(line)) {
      if (o.notes) out.push({ kind: 'note', html: `<span class="ln note">${ic('crown')}${esc(line.replace(/^\s*\/\/\s*/, ''))}</span>`, words: '' });
      continue;
    }
    if (/^\s*#/.test(line)) {
      const name = line.replace(/^\s*#+\s*/, '');
      out.push({ kind: 'sec', name, html: `<span class="ln sec">${esc(name)}</span>`, words: '' });
      continue;
    }
    const r = renderLine(line, o);
    out.push({ kind: r.empty ? 'empty' : 'line', html: r.html, words: r.words });
  }
  return out;
}
function textHasChords(s) {
  return /\[([^\]\n]*)\]/.test(s || '') && [...(s || '').matchAll(/\[([^\]\n]*)\]/g)].some(m => isChord(m[1]));
}
const wordCount = (s) => (s.match(/\S+/g) || []).length;

const isLine = () => prefs.mode === 'line';
function vh() { return pScroll.clientHeight; }
function maxPos() { return Math.max(0, pText.offsetHeight - vh()); }
function duree() { const t = curTexte(); return (t && t.reglages && +t.reglages.duree) || 0; }
// Vitesse en pixels/s : calée sur la durée du morceau si demandé, sinon réglage manuel.
function pxPerSec() {
  if (P.fit && duree() && maxPos() > 0) return maxPos() / duree();
  return P.speed * prefs.font * 0.04;
}
// Mode ligne : temps passé sur une ligne (proportionnel à son nombre de mots).
function lineDur(st) {
  const w = Math.max(1, st.words);
  if (P.fit && duree()) return Math.max(0.8, duree() * w / P.totalWords);
  return Math.max(1.2, w * 60 / (P.speed * 8));
}

function applyStyle() {
  const v = $('#v-prompter');
  v.classList.remove('th-dark', 'th-yellow', 'th-light');
  v.classList.add('th-' + prefs.theme);
  pScroll.className = 'p-scroll th-' + prefs.theme;
  pLines.className = 'p-lines th-' + prefs.theme + (isLine() ? '' : ' hidden');
  pScroll.classList.toggle('hidden', isLine());
  for (const el of [pText, $('#pl-inner')]) {
    el.style.fontSize = prefs.font + 'px';
    el.style.lineHeight = prefs.lh;
    el.style.paddingLeft = el.style.paddingRight = prefs.margin + 'vw';
    el.style.textAlign = isLine() && el !== pText ? 'center' : prefs.align;
    el.style.textTransform = prefs.upper ? 'uppercase' : 'none';
  }
  pText.style.paddingTop = (prefs.guide / 100 * vh()) + 'px';
  pText.style.paddingBottom = ((1 - prefs.guide / 100) * vh()) + 'px';
  const tf = [];
  if (prefs.mirror) tf.push('scaleX(-1)');
  if (prefs.flip) tf.push('scaleY(-1)');
  pScroll.style.transform = pLines.style.transform = tf.join(' ');
  const g = $('#p-guide');
  g.classList.toggle('hidden', !prefs.showguide || isLine());
  const half = prefs.font * prefs.lh * 0.5;
  g.style.top = (prefs.flip ? 100 - prefs.guide : prefs.guide) + '%';
  g.style.marginTop = (prefs.flip ? -half : half) + 'px';
  if (isLine()) setLine(P.li); else setPos(P.pos);
}

function setPos(p) {
  P.pos = clamp(p, 0, maxPos());
  pText.style.transform = `translate3d(0, ${-P.pos}px, 0)`;
  const m = maxPos();
  $('#p-prog').style.width = (m ? P.pos / m * 100 : 0) + '%';
  updateMeta();
}

// Mode « une ligne à la fois » : ligne précédente, section, ligne en cours (grande), ligne suivante.
function setLine(i) {
  const n = P.steps.length;
  P.li = clamp(i, 0, Math.max(0, n - 1));
  const st = P.steps[P.li], prev = P.steps[P.li - 1], next = P.steps[P.li + 1];
  $('#pl-prev').innerHTML = prev ? prev.html : '';
  $('#pl-sec').textContent = st && st.sec ? st.sec : '';
  $('#pl-cur').innerHTML = st ? st.html : '';
  $('#pl-next').innerHTML = next ? next.html : '';
  $('#p-prog').style.width = (n > 1 ? P.li / (n - 1) * 100 : 0) + '%';
  updateMeta();
}

function curTexte() { return db.textes[P.queue[P.idx]]; }
function curSection() {
  if (!P.sections.length) return -1;
  if (isLine()) { const st = P.steps[P.li]; return st ? st.secIdx : -1; }
  let k = -1;
  P.sections.forEach((s, i) => { if (sectionPos(s) <= P.pos + 2) k = i; });
  return k;
}
function sectionPos(s) { return s.el ? s.el.offsetTop - parseFloat(pText.style.paddingTop || 0) : 0; }

// Construit l'affichage du texte courant (accords, transposition, notes admin, sections, lignes).
function renderSong(keep) {
  const t = curTexte();
  const ratio = keep && maxPos() ? P.pos / maxPos() : 0;
  P.lines = parseText(t.contenu || '', { chords: prefs.chords, transpo: P.transpo, notes: canEdit() });
  pText.innerHTML = P.lines.map(l => l.html).join('');
  const secEls = pText.querySelectorAll('.sec');
  P.sections = []; P.steps = [];
  let si = 0, cur = '', curIdx = -1;
  P.lines.forEach((l, i) => {
    if (l.kind === 'sec') {
      P.sections.push({ name: l.name, el: secEls[si++], line: i, step: null });
      cur = l.name; curIdx = P.sections.length - 1;
      return;
    }
    if (l.kind === 'empty') return;
    const sec = P.sections[curIdx];
    if (sec && sec.step === null) sec.step = P.steps.length;
    P.steps.push({ html: l.html, words: wordCount(l.words || ''), sec: cur, secIdx: curIdx });
  });
  P.sections.forEach(s => { if (s.step === null) s.step = P.steps.length - 1; });
  P.totalWords = P.steps.reduce((n, st) => n + Math.max(1, st.words), 0) || 1;
  P.hasCh = textHasChords(t.contenu);
  $('#p-sec-btn').classList.toggle('hidden', !P.sections.length);
  if (keep && !isLine()) setTimeout(() => setPos(ratio * maxPos()), 0);
}

function loadSong(i) {
  P.idx = clamp(i, 0, P.queue.length - 1);
  const t = curTexte();
  const r = t.reglages || {};
  P.speed = r.vitesse || prefs.speed;
  P.transpo = r.transpo || 0;
  P.fit = !!(prefs.fit && +r.duree);
  P.pos = 0; P.li = 0; P.elapsed = 0;
  renderSong(false);
  $('#p-title').textContent = t.titre || 'Sans titre';
  $('#p-prev').disabled = P.idx === 0;
  $('#p-next').disabled = P.idx >= P.queue.length - 1;
  $('#p-endcard').classList.add('hidden');
  clearTimeout(P.autoTimer);
  applyStyle();
  updateSpeedLabel();
  renderTimer();
  trackPresence();
  sendState(true);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function remainingTime() {
  if (isLine()) {
    let r = 0;
    for (let k = P.li; k < P.steps.length; k++) r += lineDur(P.steps[k]);
    return r;
  }
  return pxPerSec() ? Math.max(0, (maxPos() - P.pos) / pxPerSec()) : 0;
}
function updateMeta() {
  const d = new Date();
  const clock = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  const parts = [];
  if (P.queue.length > 1) parts.push(`${P.idx + 1}/${P.queue.length}`);
  parts.push(`reste ${fmtTime(remainingTime())}`, clock);
  $('#p-meta').textContent = parts.join(' · ');
}

// Minuteur : temps restant (si une durée est indiquée) ou temps écoulé, toujours visible.
function renderTimer() {
  const el = $('#p-timer');
  el.classList.toggle('hidden', !prefs.timer || !P.open);
  if (!prefs.timer) return;
  const target = duree();
  el.classList.remove('warn', 'over');
  if (target) {
    const left = target - P.elapsed;
    el.innerHTML = ic('clock') + (left < 0 ? '+' + fmtTime(-left) : fmtTime(left));
    if (left < 0) el.classList.add('over');
    else if (left <= Math.max(15, target * 0.1)) el.classList.add('warn');
  } else el.innerHTML = ic('clock') + fmtTime(P.elapsed);
}
let timerLast = 0;
setInterval(() => {
  const now = Date.now();
  if (P.open && P.playing && timerLast) P.elapsed += (now - timerLast) / 1000;
  timerLast = now;
  if (P.open) renderTimer();
}, 250);

let shownPlaying = null;
function updateSpeedLabel() {
  $('#p-speed').textContent = P.fit ? `auto (${fmtTime(duree())})` : P.speed;
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
  renderTimer();
  releaseWake();
  untrackPresence();
  sendState(true);
  back();
}

function tick(t) {
  if (!P.playing || isLine()) return;
  const dt = Math.min(0.1, (t - (P.last || t)) / 1000);
  P.last = t;
  if (!P.dragging) {
    setPos(P.pos + pxPerSec() * dt);
    if (P.pos >= maxPos() - 0.5) { onEnd(); return; }
  }
  P.raf = requestAnimationFrame(tick);
}
function scheduleLine() {
  clearTimeout(P.lineTimer);
  if (!P.playing || !isLine() || !P.steps.length) return;
  P.lineTimer = setTimeout(() => {
    if (P.li >= P.steps.length - 1) { onEnd(); return; }
    setLine(P.li + 1); sendState(); scheduleLine();
  }, lineDur(P.steps[P.li]) * 1000);
}

function atStart() {
  if (isLine()) return P.li === 0;
  const first = P.sections[0];
  return P.pos < 2 || (first && first.line === 0 && Math.abs(P.pos - sectionPos(first)) < 2);
}
function atEnd() { return isLine() ? P.li >= P.steps.length - 1 && P.ended : P.pos >= maxPos() - 1; }
function toStart() { if (isLine()) setLine(0); else setPos(0); }

function play() {
  if (P.playing || P.counting) return;
  if (atEnd()) toStart();
  P.ended = false;
  $('#p-endcard').classList.add('hidden');
  if (atStart() && prefs.count > 0) return countdown(prefs.count);
  reallyPlay();
}
function reallyPlay() {
  P.playing = true; P.last = 0;
  if (isLine()) scheduleLine(); else P.raf = requestAnimationFrame(tick);
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
  P.playing = false; cancelAnimationFrame(P.raf); clearTimeout(P.lineTimer);
  if (P.counting) { P.counting = false; clearTimeout(P.countTimer); $('#p-count').classList.add('hidden'); }
  updateSpeedLabel(); showUi(); sendState(true);
  if (was) trackPresence();
}
function toggle() { (P.playing || P.counting) ? pause() : play(); }

function onEnd() {
  pause();
  P.ended = true;
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

// Réglage propre à la chanson (vitesse, tonalité) : l'admin le partage, un membre le garde pour lui.
function saveSongSetting(key, val) {
  clearTimeout(P.saveTimers[key]);
  P.saveTimers[key] = setTimeout(() => {
    const t = curTexte(); if (!t || t.id === DEMO_ID) return;
    t.reglages = Object.assign({}, t.reglages, { [key]: val });
    if (canEdit()) touchTexte(t); else db.save();
  }, 1500);
}
function changeSpeed(d) {
  if (P.fit) {
    // on reprend la main : on part de la vitesse calée actuelle
    P.speed = clamp(Math.round(pxPerSec() / (prefs.font * 0.04)), 1, 60);
    P.fit = false;
    toast('Vitesse manuelle');
  }
  P.speed = clamp(P.speed + d, 1, 60);
  updateSpeedLabel(); updateMeta(); sendState(true);
  if (isLine() && P.playing) scheduleLine();
  saveSongSetting('vitesse', P.speed);
}
function changeTranspo(d) {
  if (!P.hasCh) return;
  P.transpo = ((P.transpo + d + 17) % 12) - 5;   // de -5 à +6 demi-tons
  renderSong(true);
  if (isLine()) setLine(P.li);
  renderSettings();
  toast(P.transpo ? `Tonalité ${P.transpo > 0 ? '+' : ''}${P.transpo}` : 'Tonalité d\'origine');
  sendState(true);
  saveSongSetting('transpo', P.transpo);
}
function nudge(fraction) {
  if (isLine()) { setLine(P.li + (fraction > 0 ? 1 : -1)); if (P.playing) scheduleLine(); }
  else setPos(P.pos + vh() * fraction);
  sendState(true);
}
function gotoSection(i) {
  const s = P.sections[i]; if (!s) return;
  if (isLine()) { setLine(s.step); if (P.playing) scheduleLine(); }
  else setPos(sectionPos(s));
  $('#p-endcard').classList.add('hidden');
  sendState(true);
}

/* --- sections --- */
$('#p-sec-btn').onclick = () => {
  const ul = $('#p-sec-list'); ul.innerHTML = '';
  const cur = curSection();
  P.sections.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = i === cur ? 'checked' : '';
    li.innerHTML = `<span class="li-num">${i + 1}</span><div class="li-main"><div class="li-title"></div></div>${ic('chevron')}`;
    li.querySelector('.li-title').textContent = s.name;
    li.onclick = () => { $('#p-secsheet').classList.add('hidden'); gotoSection(i); };
    ul.appendChild(li);
  });
  $('#p-secsheet').classList.remove('hidden');
};
$('#p-secsheet-done').onclick = () => $('#p-secsheet').classList.add('hidden');
$('#p-secsheet').addEventListener('click', (e) => { if (e.target.id === 'p-secsheet') $('#p-secsheet').classList.add('hidden'); });

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
// mode ligne : toucher = lecture/pause, glisser vers le haut = ligne suivante, vers le bas = précédente
let lStart = null;
pLines.addEventListener('touchstart', (e) => { lStart = { y: e.touches[0].clientY, t: performance.now() }; }, { passive: true });
pLines.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
pLines.addEventListener('touchend', (e) => {
  if (!lStart) return;
  const dy = (e.changedTouches[0].clientY - lStart.y) * (prefs.flip ? -1 : 1);
  lStart = null; lastTouchEnd = performance.now();
  if (Math.abs(dy) > 40) nudge(dy < 0 ? 1 : -1); else toggle();
});
pLines.addEventListener('click', () => { if (performance.now() - lastTouchEnd > 800) toggle(); });
pLines.addEventListener('wheel', (e) => { e.preventDefault(); if (Math.abs(e.deltaY) > 20) nudge(e.deltaY > 0 ? 1 : -1); }, { passive: false });
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
  const sheetOpen = !$('#p-settings').classList.contains('hidden') || !$('#p-secsheet').classList.contains('hidden');
  if (sheetOpen && e.key !== 'Escape') return;
  const k = e.key;
  let handled = true;
  if (k === ' ' || k === 'Enter' || k === 'k') toggle();
  else if (k === 'ArrowDown' || k === 'PageDown') nudge(0.35);
  else if (k === 'ArrowUp' || k === 'PageUp') nudge(-0.35);
  else if (k === 'ArrowRight') goSong(P.idx + 1);
  else if (k === 'ArrowLeft') goSong(P.idx - 1);
  else if (k === '+' || k === '=') changeSpeed(1);
  else if (k === '-' || k === '_') changeSpeed(-1);
  else if (k === 'Home') toStart();
  else if (k === 'Escape') {
    if (sheetOpen) { closeSettings(); $('#p-secsheet').classList.add('hidden'); } else closePrompter();
  }
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
const checks = { mirror: 's-mirror', flip: 's-flip', upper: 's-upper', showguide: 's-showguide', autonext: 's-autonext',
  chords: 's-chords', fit: 's-fit', timer: 's-timer' };

function renderSettings() {
  for (const [k, id] of Object.entries(sliders)) {
    const v = k === 'speed' ? P.speed : prefs[k];
    $('#' + id).value = v; $('#' + id + '-v').textContent = fmt[k](v);
  }
  for (const [k, id] of Object.entries(checks)) $('#' + id).checked = !!prefs[k];
  $$('#s-align button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.align));
  $$('#s-theme button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.theme));
  $$('#s-mode button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.mode));
  $('#s-tr-row').classList.toggle('hidden', !P.hasCh);
  $('#s-tr-v').textContent = (P.transpo > 0 ? '+' : '') + P.transpo;
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
  $('#' + id).addEventListener('change', (e) => {
    prefs[k] = e.target.checked; savePrefs();
    if (k === 'chords') renderSong(true);
    if (k === 'fit') { P.fit = !!(prefs.fit && duree()); updateSpeedLabel(); if (isLine() && P.playing) scheduleLine(); }
    if (k === 'timer') renderTimer();
    applyStyle(); sendState();
  });
}
// changement de mode : on garde à peu près l'endroit où on en était
$$('#s-mode button').forEach(b => b.onclick = () => {
  if (prefs.mode === b.dataset.v) return;
  const ratio = isLine() ? (P.steps.length > 1 ? P.li / (P.steps.length - 1) : 0) : (maxPos() ? P.pos / maxPos() : 0);
  pause();
  prefs.mode = b.dataset.v; savePrefs();
  applyStyle();
  if (isLine()) setLine(Math.round(ratio * Math.max(0, P.steps.length - 1)));
  else setTimeout(() => setPos(ratio * maxPos()), 0);
  renderSettings(); sendState();
});
$('#s-tr-minus').onclick = () => changeTranspo(-1);
$('#s-tr-plus').onclick = () => changeTranspo(1);
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
      if (l && l.reglages && !canEdit()) {
        const mine = {};
        if (l.reglages.vitesse) mine.vitesse = l.reglages.vitesse;
        if (l.reglages.transpo) mine.transpo = l.reglages.transpo;
        rest.reglages = Object.assign({}, rest.reglages, mine);
      }
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
  if (session) { await loadTeams(); await loadMembers(); renderAccount(); loadFeedback(); }
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
  else if (a === 'top') { pause(); toStart(); }
  else if (a === 'next') goSong(P.idx + 1);
  else if (a === 'prev') goSong(P.idx - 1);
  else if (a === 'goto') goSong(+c.i);
  else if (a === 'section') gotoSection(+c.i);
  else if (a === 'tr+') changeTranspo(1);
  else if (a === 'tr-') changeTranspo(-1);
  else if (a === 'close') { showBy(c); closePrompter(); sendState(true); return; }
  showBy(c);
  sendState(true);
}

// Plusieurs télécommandes : on affiche brièvement qui a envoyé la commande.
const CMD_LABEL = {
  toggle: () => (P.playing || P.counting) ? 'Lecture' : 'Pause', 'speed+': () => 'Vitesse +', 'speed-': () => 'Vitesse −',
  fwd: () => 'Avancer', back: () => 'Reculer', top: () => 'Début', next: () => 'Morceau suivant', prev: () => 'Morceau précédent',
  goto: () => 'Changement de morceau', section: () => 'Section', 'tr+': () => 'Tonalité +', 'tr-': () => 'Tonalité −', close: () => 'Fermeture'
};
let byTimer = 0;
function showBy(c) {
  if (!c.by) return;
  P.lastBy = c.by; P.lastByAt = Date.now();
  const el = $('#p-by');
  el.textContent = `${(CMD_LABEL[c.a] || (() => 'Commande'))()} · ${c.by}`;
  el.classList.remove('hidden');
  clearTimeout(byTimer); byTimer = setTimeout(() => el.classList.add('hidden'), 2200);
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
  const prog = isLine() ? (P.steps.length > 1 ? P.li / (P.steps.length - 1) : 0) : (m ? P.pos / m : 0);
  TC.ch.send({
    type: 'broadcast', event: 'state',
    payload: {
      from: prefs.deviceId, nom: prefs.deviceName, open: true,
      titre: t ? (t.titre || 'Sans titre') : '', idx: P.idx, n: P.queue.length,
      playing: P.playing || P.counting, speed: P.fit ? 'auto' : P.speed, prog,
      songs: P.queue.map(id => (db.textes[id] && db.textes[id].titre) || 'Sans titre'),
      line: isLine(), hasCh: P.hasCh, transpo: P.transpo,
      secs: P.sections.map(x => x.name), sec: curSection(),
      by: P.lastBy && Date.now() - P.lastByAt < 15000 ? P.lastBy : ''
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
  TC.ch.send({ type: 'broadcast', event: 'cmd', payload: Object.assign({ to: RC.target, a, by: prefs.deviceName }, extra) });
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
  $('#rc-tr-row').classList.toggle('hidden', !s.hasCh);
  $('#rc-tr').textContent = (s.transpo > 0 ? '+' : '') + (s.transpo || 0);
  const fwdBtn = $('[data-rc=fwd]'), backBtn = $('[data-rc=back]');
  fwdBtn.innerHTML = (s.line ? 'Ligne suivante' : 'Avancer') + ic('forward');
  backBtn.innerHTML = ic('rewind') + (s.line ? 'Ligne précédente' : 'Reculer');
  const by = $('#rc-by');
  by.classList.toggle('hidden', !s.by);
  by.textContent = s.by ? 'Dernière commande : ' + (s.by === prefs.deviceName ? 'toi' : s.by) : '';
  const secs = $('#rc-secs');
  const skey = JSON.stringify([s.secs, s.sec]);
  if (secs.dataset.key !== skey) {
    secs.dataset.key = skey; secs.innerHTML = '';
    (s.secs || []).forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'chip' + (i === s.sec ? ' on' : '');
      b.textContent = name;
      b.onclick = () => rcSend('section', { i });
      secs.appendChild(b);
    });
  }
  secs.classList.toggle('hidden', !(s.secs && s.secs.length));
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
/* --- préparer le téléphone pour la scène ---
   Une appli web ne peut pas ouvrir les Réglages de l'iPhone (Apple le réserve aux applis de l'App Store) :
   on donne donc le chemin exact de chaque réglage. */
function stageChecklist() {
  const android = /Android/.test(navigator.userAgent);
  const steps = android ? [
    '1. Ne pas déranger : glisse deux fois depuis le haut de l\'écran et touche « Ne pas déranger ».',
    '2. Mise en veille : Paramètres > Affichage > Mise en veille de l\'écran > le plus long possible.',
    '3. Luminosité : au maximum, et désactive la luminosité adaptative si l\'écran baisse tout seul.',
    '4. Batterie : branche le téléphone ou vérifie qu\'il est bien chargé. Désactive l\'économiseur de batterie.',
    '5. Laisse Prompteur ouvert au premier plan. La télécommande a besoin d\'internet : pas de mode Avion si tu l\'utilises.'
  ] : [
    '1. Ne pas déranger : glisse depuis le coin en haut à droite de l\'écran, touche « Concentration » puis « Ne pas déranger ».',
    '2. Verrouillage automatique : Réglages > Luminosité et affichage > Verrouillage automatique > Jamais.',
    '3. Luminosité : au maximum dans le même menu. Si elle baisse toute seule : Réglages > Accessibilité > Affichage et taille du texte > désactive « Luminosité automatique ».',
    '4. Batterie : branche le téléphone ou vérifie qu\'il est bien chargé. Désactive le mode Économie d\'énergie (il peut couper la télécommande).',
    '5. Laisse Prompteur ouvert au premier plan. La télécommande a besoin d\'internet : pas de mode Avion si tu l\'utilises.'
  ];
  return modal({
    title: 'Avant de monter sur scène', icon: 'check',
    message: steps.join('\n\n') + '\n\nUne appli web ne peut pas ouvrir ces réglages directement : ouvre l\'app Réglages et suis ces étapes.',
    buttons: [{ label: 'C\'est prêt', value: true }]
  });
}
$('#s-stage').onclick = () => stageChecklist();
$('#help-stage').onclick = () => stageChecklist();

/* --- retours des testeurs --- */
const APP_VERSION = 'v20';
function deviceLabel(ua) {
  const ios = ua.match(/OS (\d+)_(\d+)/);
  if (/iPhone/.test(ua)) return 'iPhone' + (ios ? ` iOS ${ios[1]}.${ios[2]}` : '');
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return 'iPad' + (ios ? ` iOS ${ios[1]}.${ios[2]}` : '');
  const and = ua.match(/Android (\d+)/); if (and) return 'Android ' + and[1];
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Autre appareil';
}
async function sendFeedback() {
  if (!sb) return toast('Envoi impossible : sauvegarde en ligne non configurée');
  const msg = await promptModal('Un souci ou une idée ?', 'Décris ce qui s\'est passé ou ce que tu aimerais. Ton modèle de téléphone est ajouté automatiquement pour aider à corriger.',
    'Envoyer', { multiline: true, placeholder: 'Ex : quand j\'appuie sur Suivant depuis la télécommande, rien ne se passe…', icon: 'message', min: 3, minMsg: 'Écris quelques mots' });
  if (!msg) return;
  if (!navigator.onLine) return toast('Pas de connexion : réessaie quand tu as du réseau');
  const t = team.current();
  const { error } = await sb.from('prompteur_retours').insert({
    message: msg.slice(0, 4000), email: session ? session.user.email : '', appareil: navigator.userAgent.slice(0, 400),
    contexte: { version: APP_VERSION, installee: isInstalled, equipe: t ? t.nom : null, role: t ? t.role : null,
      ecran: `${window.innerWidth}x${window.innerHeight}`, prompteur_ouvert: P.open }
  });
  if (error) return toast('Envoi impossible : ' + frErr(error));
  modal({ title: 'Merci !', icon: 'check', message: 'Ton message a bien été envoyé.', buttons: [{ label: 'OK', value: true }] });
}
$('#help-feedback').onclick = sendFeedback;
$('#acc-feedback').onclick = sendFeedback;

// Le propriétaire de l'appli voit les retours dans Compte et équipe.
let fbTab = 'new', fbOwner = false;
async function loadFeedback() {
  if (!sb || !session) { $('#fb-owner').classList.add('hidden'); return; }
  const own = await sb.from('prompteur_proprietaires').select('user_id').eq('user_id', session.user.id);
  fbOwner = !own.error && own.data && own.data.length > 0;
  $('#fb-owner').classList.toggle('hidden', !fbOwner);
  if (!fbOwner) return;
  const { data, error } = await sb.from('prompteur_retours').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return;
  const todo = data.filter(r => !r.traite);
  $('#fb-count').textContent = todo.length ? todo.length : '';
  $('#fb-count').classList.toggle('hidden', !todo.length);
  const rows = data.filter(r => fbTab === 'new' ? !r.traite : r.traite);
  const ul = $('#fb-list'); ul.innerHTML = '';
  if (!rows.length) ul.innerHTML = `<p class="empty">${fbTab === 'new' ? 'Aucun retour à traiter.' : 'Aucun retour traité.'}</p>`;
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'fb-item';
    li.innerHTML = `<div class="li-main"><div class="fb-meta"></div><div class="fb-msg"></div></div>
      <button class="li-small" aria-label="${r.traite ? 'Remettre à traiter' : 'Marquer comme traité'}">${ic(r.traite ? 'refresh' : 'check')}</button>`;
    const quand = new Date(r.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    li.querySelector('.fb-meta').textContent = `${quand} · ${r.email || 'anonyme'} · ${deviceLabel(r.appareil || '')}` + (r.contexte && r.contexte.version ? ` · ${r.contexte.version}` : '');
    li.querySelector('.fb-msg').textContent = r.message;
    li.querySelector('button').onclick = async () => {
      const { error: e2 } = await sb.from('prompteur_retours').update({ traite: !r.traite }).eq('id', r.id);
      if (e2) return toast(frErr(e2));
      loadFeedback();
    };
    ul.appendChild(li);
  }
}
$$('#fb-tabs button').forEach(b => b.onclick = () => {
  fbTab = b.dataset.v; $$('#fb-tabs button').forEach(x => x.classList.toggle('on', x === b)); loadFeedback();
});

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
