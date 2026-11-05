'use strict';
/* AsisVet Laboratorio · portal de veterinarios y panel del laboratorio */
const $ = (s, r = document) => r.querySelector(s);
const h = (t, a = {}, ...k) => { const e = document.createElement(t); for (const [n, v] of Object.entries(a)) { if (n === 'class') e.className = v; else if (n.startsWith('on')) e[n] = v; else if (v !== false && v != null) e.setAttribute(n, v === true ? '' : v); }
  e.append(...k.flat(9).filter(x => x != null && x !== false).map(x => x instanceof Node ? x : document.createTextNode(String(x)))); return e; };
/** Agrega hijos ignorando null/false y aplanando listas (a diferencia de Element.append). */
const put = (el, ...k) => { el.append(...k.flat(9).filter(x => x != null && x !== false)); return el; };
const cop = n => '$ ' + Number(n || 0).toLocaleString('es-CO');
const fdate = d => new Date(d).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const fday = d => new Date(d).toLocaleDateString('es-CO', { dateStyle: 'medium' });
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const S = { token: localStorage.getItem('asv.t') || '', user: null, view: null, timer: null, labs: [], services: {}, installEvt: null };
const REQ_ST = { enviada: ['Enviada', 'warn'], en_proceso: ['En proceso', ''], finalizada: ['Finalizada', 'ok'], rechazada: ['Rechazada', 'crit'], cancelada: ['Cancelada', 'crit'] };
const PAT_ST = { pend: ['Por recibir', 'warn'], rec: ['Recibida', ''], done: ['Resultado listo', 'ok'], rej: ['Rechazada', 'crit'] };
const pill = (map, k) => h('span', { class: 'pill ' + (map[k]?.[1] || '') }, map[k]?.[0] || k);
const KIND = { lab_result_pdf: 'Resultado', generated_report: 'Orden de servicio', attachment: 'Adjunto', patient_photo: 'Foto del paciente', sample_photo: 'Foto de la muestra' };

async function api(url, o = {}) {
  const hd = { ...(o.json ? { 'Content-Type': 'application/json' } : {}), ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}), ...(o.lab ? { 'X-Lab': o.lab } : {}) };
  const r = await fetch(url, { method: o.method || (o.json || o.body ? 'POST' : 'GET'), headers: hd, body: o.json ? JSON.stringify(o.json) : o.body });
  if (r.status === 401 && S.token && !url.includes('/auth/')) { logout(); throw new Error('Su sesión venció. Ingrese de nuevo.'); }
  if (!r.ok) { let m = 'No se pudo completar la acción'; try { m = (await r.json()).message || m; } catch {} throw new Error(m); }
  return r.status === 204 ? null : r.json();
}
function toast(msg, ms = 3200) { $('.toast')?.remove(); const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), ms); }
const busy = async (btn, fn) => { btn.disabled = true; try { return await fn(); } finally { btn.disabled = false; } };

/* ---------- apariencia (mismas claves y paletas de la app del laboratorio) ---------- */
const PALS = [['petroleo', 'Petróleo', ['#183B50', '#24566C', '#367C91']], ['salvia', 'Salvia', ['#29483E', '#416B59', '#759784']], ['azul', 'Azul', ['#153D65', '#245F91', '#4C8DB8']], ['ciruela', 'Ciruela', ['#493047', '#674765', '#95718F']], ['grafito', 'Grafito', ['#252B31', '#424B54', '#74818C']]];
function theme() { const t = lsGet('av.theme.last', {}); return { m: ['auto', 'light', 'dark'].includes(t.m) ? t.m : 'auto', p: PALS.some(x => x[0] === t.p) ? t.p : 'petroleo' }; }
function applyTheme(t) { const dk = t.m === 'dark' || (t.m === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); const d = document.documentElement; d.setAttribute('data-avm', dk ? 'dark' : 'light'); d.setAttribute('data-avp', t.p); lsSet('av.theme.last', t); document.querySelector('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(d).getPropertyValue('--accent').trim() || '#183B50'); }
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(theme()));
function appearance() {
  const box = h('div'), draw = () => { const t = theme(); box.textContent = '';
    put(box, h('div', { class: 'ap-s' }, 'Modo'), h('div', { class: 'seg' }, [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, n]) => h('button', { type: 'button', 'aria-pressed': t.m === k, onclick: () => { applyTheme({ ...theme(), m: k }); draw(); } }, n))),
      h('div', { class: 'ap-s' }, 'Paleta'), h('div', { class: 'pgrid' }, PALS.map(([k, n, c]) => h('button', { type: 'button', class: 'pcard2', 'aria-pressed': t.p === k, onclick: () => { applyTheme({ ...theme(), p: k }); draw(); } }, h('span', { class: 'sw' }, c.map(x => h('i', { style: 'background:' + x }))), n)))); };
  draw(); return box;
}
applyTheme(theme());

/* ---------- ventanas ---------- */
function overlay(content, { big = false, onClose } = {}) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); onClose?.(); }, esc = e => e.key === 'Escape' && close();
  const ov = h('div', { class: 'ov', role: 'dialog', 'aria-modal': 'true', onclick: e => e.target === ov && close() }, h('div', { class: 'lgbox' + (big ? ' big' : '') }, content));
  document.addEventListener('keydown', esc); document.body.append(ov); return { close, ov };
}
const seenKey = () => 'asv.seen.' + S.user?.id; const seen = () => new Set(lsGet(seenKey(), []));
const markSeen = id => { const s = seen(); s.add(id); lsSet(seenKey(), [...s].slice(-500)); };
async function openDoc(d, lab) {
  const vw = h('div', { class: 'vw' }, 'Cargando…'), dl = h('button', { class: 'btn', type: 'button' }, 'Descargar'), nw = h('a', { class: 'btn', target: '_blank', rel: 'noopener', hidden: true }, 'Abrir en otra pestaña'), x = h('button', { class: 'btn', type: 'button' }, 'Cerrar ✕');
  const o = overlay([h('div', { class: 'row', style: 'margin-bottom:8px' }, h('b', { class: 'grow', style: 'overflow-wrap:anywhere' }, d.filename), nw, dl, x), vw], { big: true }); x.onclick = o.close; markSeen(d.id);
  dl.onclick = () => busy(dl, async () => { try { location.href = (await api(`/api/documents/${d.id}/url?disposition=attachment`, { lab })).url; } catch (e) { toast(e.message); } });
  try { const isImg = d.mime.startsWith('image/'); const { url } = await api(`/api/documents/${d.id}/url?disposition=inline` + (isImg && d.hasThumbnail ? '&variant=optimized' : ''), { lab }); vw.textContent = '';
    if (isImg) vw.append(h('img', { src: url, alt: d.filename })); else if (d.mime === 'application/pdf') { vw.append(h('iframe', { src: url, title: d.filename })); nw.href = url; nw.hidden = false; } else vw.textContent = 'Este formato no se puede mostrar aquí. Use «Descargar».';
  } catch (e) { vw.textContent = e.message; }
}
function uploader({ requestId, patientId, kind, label, lab, onDone, cls = 'btn sm' }) {
  const inp = h('input', { type: 'file', multiple: true, accept: 'application/pdf,image/*', hidden: true });
  inp.onchange = async () => { if (!inp.files.length) return; const fd = new FormData(); fd.append('kind', kind); fd.append('requestId', requestId); if (patientId) fd.append('patientId', patientId); for (const f of inp.files) fd.append('files', f, f.name);
    toast('Subiendo…', 20000);
    try { const r = await fetch('/api/documents', { method: 'POST', headers: { Authorization: 'Bearer ' + S.token, ...(lab ? { 'X-Lab': lab } : {}) }, body: fd }); const j = await r.json();
      if (!j.results) throw new Error(j.message || 'No se pudo subir'); const bad = j.results.filter(x => !x.ok);
      toast(bad.length ? 'No se aceptó: ' + bad.map(b => `${b.filename} (${b.message})`).join('; ') : 'Archivo enviado. Se está revisando por seguridad…', bad.length ? 7000 : 3500); onDone?.();
    } catch (e) { toast(e.message, 6000); } inp.value = ''; };
  return [h('button', { class: cls, type: 'button', onclick: () => inp.click() }, label), inp];
}
function docRow(d, lab) {
  const isNew = d.kind === 'lab_result_pdf' && S.user.role === 'vet' && !seen().has(d.id);
  return h('div', { class: 'doc' }, h('span', {}, h('b', {}, d.filename), h('br'), h('span', { class: 'muted small' }, `${KIND[d.kind] || d.kind} · ${fdate(d.createdAt)}${d.status === 'processing' ? ' · en revisión…' : d.status !== 'available' ? ' · no disponible' : ''}`)),
    isNew && h('span', { class: 'pill ok' }, 'Nuevo'), h('button', { class: 'btn sm p', type: 'button', disabled: d.status !== 'available', onclick: () => openDoc(d, lab) }, 'Ver'));
}
const timeline = r => h('div', { class: 'tl' }, r.events.map(e => h('div', {}, pill(REQ_ST, e.status), ' ', h('span', { class: 'muted small' }, `${fdate(e.at)} · ${e.by}${e.note ? ' · ' + e.note : ''}`))));
const exportBtns = qs => h('span', { class: 'row' }, ['csv', 'xlsx'].map(f => h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { const r = await fetch(`/api/requests/export.${f}?${qs()}`, { headers: { Authorization: 'Bearer ' + S.token } }); if (!r.ok) throw new Error('No se pudo exportar');
  const a = h('a', { href: URL.createObjectURL(await r.blob()), download: `solicitudes.${f}` }); document.body.append(a); a.click(); a.remove(); } catch (e) { toast(e.message); } } }, '⬇ ' + (f === 'csv' ? 'CSV' : 'Excel'))));
const head = (t, sub, ...right) => h('div', { class: 'toolbar' }, h('div', {}, h('h1', {}, t), sub && h('p', { class: 'small muted', style: 'margin:4px 0 0' }, sub)), right.length ? h('div', { class: 'row' }, right) : null);
const poll = (fn, ms) => { clearInterval(S.timer); S.timer = setInterval(() => { if (!document.hidden && !$('.ov')) fn(); }, ms); };
const spLabel = s => ({ canino: 'Canino', felino: 'Felino', equino: 'Equino', bovino: 'Bovino', ovino: 'Ovino', caprino: 'Caprino', porcino: 'Porcino', aviar: 'Aviar', otro: 'Otro' }[s] || s);

/* ---------- acceso ---------- */
function logout() { localStorage.removeItem('asv.t'); S.token = ''; S.user = null; clearInterval(S.timer); boot(); }
async function boot() {
  clearInterval(S.timer);
  if (S.token) { try { S.user = (await api('/api/me')).user; } catch { S.token = ''; S.user = null; } }
  S.user ? shell() : authView();
}
async function authView() {
  const labs = (await api('/api/labs').catch(() => ({ labs: [] }))).labs, root = $('#app'); root.textContent = ''; document.title = 'AsisVet Laboratorio'; let mode = 'in';
  const f = { email: h('input', { type: 'email', autocomplete: 'username', autocapitalize: 'none', required: true }), pw: h('input', { type: 'password', autocomplete: 'current-password', required: true }), pw2: h('input', { type: 'password', autocomplete: 'new-password' }),
    name: h('input', { autocomplete: 'name' }), clinic: h('input'), phone: h('input', { type: 'tel', inputmode: 'tel' }), city: h('input'), code: h('input', { placeholder: 'Ej. ABCD-2345', autocapitalize: 'characters' }),
    lab: h('select', {}, h('option', { value: '' }, '— Elegir laboratorio (opcional) —'), labs.map(l => h('option', { value: l.id }, l.name + (l.city ? ' · ' + l.city : '')))) };
  const field = (t, el, extra = {}) => h('label', { class: 'f', ...extra }, h('span', {}, t), el);
  const regBox = h('div', { hidden: true }, field('Veterinario(a)', f.name), field('Veterinaria o consultorio', f.clinic), h('div', { class: 'grid', style: 'margin-top:10px' }, field('WhatsApp / teléfono', f.phone), field('Ciudad', f.city)),
    field('Repita la contraseña', f.pw2), h('div', { class: 'sub' }, h('b', {}, 'Laboratorio al que enviará muestras')), field('Laboratorio', f.lab), field('Código de invitación (con código queda aprobado al instante)', f.code));
  const err = h('p', { class: 'err', role: 'alert' }), go = h('button', { class: 'btn p wide', type: 'submit' }, 'Ingresar');
  const seg = h('div', { class: 'seg', style: 'width:100%;margin-bottom:12px' }, [['in', 'Ingresar'], ['reg', 'Soy veterinario: crear cuenta']].map(([k, n]) => h('button', { type: 'button', style: 'flex:1', 'aria-pressed': k === 'in', onclick: () => set(k) }, n)));
  const set = m => { mode = m; regBox.hidden = m === 'in'; go.textContent = m === 'in' ? 'Ingresar' : 'Crear cuenta'; [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', (i === 0) === (m === 'in'))); f.pw.autocomplete = m === 'in' ? 'current-password' : 'new-password'; err.textContent = ''; };
  const form = h('form', { class: 'lgbox', style: 'max-width:460px', onsubmit: async e => { e.preventDefault(); err.textContent = '';
    if (mode === 'reg' && f.pw.value !== f.pw2.value) { err.textContent = 'Las contraseñas no coinciden.'; return; }
    await busy(go, async () => { try { const r = mode === 'in' ? await api('/api/auth/login', { json: { email: f.email.value, password: f.pw.value } })
      : await api('/api/auth/register-vet', { json: { email: f.email.value, password: f.pw.value, name: f.name.value, clinicName: f.clinic.value, phone: f.phone.value, city: f.city.value, labId: f.lab.value || undefined, code: f.code.value || undefined } });
      S.token = r.token; localStorage.setItem('asv.t', r.token); boot(); } catch (x) { err.textContent = x.message; } }); } },
    h('div', { class: 'brand', style: 'margin-bottom:14px' }, h('span', { class: 'mk' }, h('img', { src: '/assets/icon-192.png', alt: '' })), h('div', {}, h('b', {}, 'AsisVet Laboratorio'), h('small', {}, 'Portal de veterinarios y laboratorios'))),
    seg, field('Correo', f.email), h('div', { style: 'height:10px' }), field('Contraseña (mínimo 8 caracteres)', f.pw), h('div', { style: 'height:10px' }), regBox, err, go);
  put(root, h('div', { class: 'auth' }, form));
}

/* ---------- estructura de la aplicación ---------- */
const NAV = {
  vet: [['envios', 'Mis envíos'], ['nueva', 'Nueva solicitud'], ['pacientes', 'Mis pacientes'], ['labs', 'Mis laboratorios']],
  lab_admin: [['inicio', 'Inicio'], ['recep', 'Recepción'], ['remitentes', 'Remitentes'], ['portafolio', 'Portafolio'], ['ajustes', 'Ajustes']],
};
NAV.lab_staff = NAV.lab_admin.filter(x => x[0] !== 'ajustes');
const VIEWS = {};
function shell() {
  const u = S.user, vet = u.role === 'vet', root = $('#app'); root.textContent = '';
  const nav = h('nav', { 'aria-label': 'Secciones' }, NAV[u.role].map(([k, n]) => h('button', { type: 'button', 'data-v': k, onclick: () => go(k) }, n, k === 'recep' && h('span', { class: 'cnt red', id: 'cntRec' }))));
  put(root, h('header', { class: 'top' }, h('div', { class: 'wrap' },
    h('div', { class: 'brand' }, h('span', { class: 'mk' }, h('img', { src: '/assets/icon-192.png', alt: '' })), h('div', {}, h('b', {}, 'AsisVet Laboratorio'), h('small', { id: 'sub' }, vet ? u.clinicName : 'Cargando…'))),
    h('div', { class: 'hact' }, vet && h('button', { class: 'btn p', type: 'button', onclick: () => go('nueva') }, '+ Nueva solicitud'), h('button', { class: 'ubtn', type: 'button', onclick: userMenu, title: 'Cuenta y apariencia' }, u.name)), nav),
    ), h('main', { class: 'wrap', id: 'main' }));
  if (!vet) api('/api/lab/settings').then(l => { $('#sub').textContent = l.name; document.title = l.name + ' · AsisVet'; }).catch(() => {});
  go(lsGet('asv.view.' + u.id, null) && NAV[u.role].some(x => x[0] === lsGet('asv.view.' + u.id)) && lsGet('asv.view.' + u.id) !== 'nueva' ? lsGet('asv.view.' + u.id) : NAV[u.role][0][0]);
}
function go(v, arg) {
  clearInterval(S.timer); S.view = v; lsSet('asv.view.' + S.user.id, v);
  document.querySelectorAll('nav button').forEach(b => b.dataset.v === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  const m = $('#main'); m.textContent = ''; scrollTo(0, 0); put(m, h('p', { class: 'muted' }, 'Cargando…')); Promise.resolve(VIEWS[v](m, arg)).catch(e => { m.textContent = ''; put(m, h('div', { class: 'banner bad' }, h('p', {}, e.message))); });
}
function userMenu() {
  const u = S.user; const inst = S.installEvt && h('button', { class: 'btn wide', type: 'button', onclick: async () => { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; o.close(); } }, '📲 Instalar como aplicación');
  const o = overlay([h('h2', {}, u.name), h('p', { class: 'small muted', style: 'margin:2px 0 0' }, `${u.email} · ${u.role === 'vet' ? 'Veterinario' : u.role === 'lab_admin' ? 'Administrador del laboratorio' : 'Personal del laboratorio'}`), appearance(), h('div', { class: 'sub' }), inst, h('button', { class: 'btn wide', type: 'button', style: 'margin-top:8px', onclick: () => { o.close(); logout(); } }, 'Cerrar sesión'), h('button', { class: 'btn wide', type: 'button', style: 'margin-top:8px', onclick: () => o.close() }, 'Cerrar')]);
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

/* =================== VETERINARIO =================== */
const myLabs = async () => (S.labs = (await api('/api/vet/labs')).labs);
const labName = id => S.labs.find(l => l.id === id)?.name || id;

VIEWS.envios = async m => {
  await myLabs().catch(() => {});
  const f = { st: h('select', {}, h('option', { value: '' }, 'Todos los estados'), Object.entries(REQ_ST).map(([k, v]) => h('option', { value: k }, v[0]))), q: h('input', { type: 'search', placeholder: 'Buscar paciente o código…' }) };
  const list = h('div'), banner = h('div'), qs = () => new URLSearchParams({ status: f.st.value, q: f.q.value }).toString();
  const load = async () => { const r = await api('/api/requests?pageSize=50&' + qs()); list.textContent = '';
    if (!r.items.length) list.append(h('div', { class: 'card' }, h('p', { style: 'margin:0' }, f.q.value || f.st.value ? 'No hay solicitudes con ese filtro.' : 'Aún no ha enviado solicitudes.'), !f.q.value && !f.st.value && h('p', {}, h('button', { class: 'btn p', type: 'button', onclick: () => go('nueva') }, '+ Nueva solicitud'))));
    let nuevos = 0; for (const r1 of r.items) list.append(reqCard(r1, n => nuevos += n));
    setTimeout(() => { banner.textContent = ''; if (nuevos) banner.append(h('div', { class: 'banner ok' }, h('p', {}, h('b', {}, `Tiene ${nuevos} ${nuevos === 1 ? 'resultado nuevo' : 'resultados nuevos'}.`), ' Ábralos en la solicitud correspondiente.'))); }, 700); };
  m.textContent = ''; put(m, head('Mis envíos', 'Solo usted ve esta lista.', exportBtns(qs)), banner, h('div', { class: 'card', style: 'margin-bottom:12px' }, h('div', { class: 'grid g2' }, f.st, f.q)), list);
  f.st.onchange = load; f.q.oninput = () => { clearTimeout(f.t); f.t = setTimeout(load, 250); }; await load(); poll(load, 20000);
};
function reqCard(r, onNew) {
  const docs = h('div'), lab = r.labId, pats = new Map(), card = h('div', { class: 'card', id: 'r-' + r.id });
  const canCancel = !r.cancelled && r.pats.every(p => p.st === 'pend');
  const rows = r.pats.map(p => { const cell = h('td', { 'data-l': 'Estado y resultado' }, pill(PAT_ST, p.st), p.why && h('div', { class: 'small', style: 'color:var(--crit);margin-top:4px' }, 'Motivo: ' + p.why)); pats.set(p.id, cell);
    return h('tr', {}, h('td', { class: 'mono', 'data-l': 'N.º muestra' }, p.no || '—'), h('td', { 'data-l': 'Paciente' }, h('b', {}, p.name), p.urg && h('span', { class: 'pill crit', style: 'margin-left:6px' }, 'Urgente'), h('div', { class: 'small muted' }, [spLabel(p.species), p.sex, p.age, p.owner].filter(Boolean).join(' · '))), h('td', { 'data-l': 'Exámenes' }, p.items.map(i => i.name).join(', ')), cell); });
  put(card, h('div', { class: 'card-h' }, h('div', {}, h('h2', {}, r.code, ' ', pill(REQ_ST, r.status), r.urg && !r.cancelled && h('span', { class: 'pill crit', style: 'margin-left:6px' }, 'Urgente')), h('div', { class: 'small muted', style: 'margin-top:4px' }, `${fdate(r.createdAt)} · ${labName(r.labId)} · ${r.delivery === 'RECOGIDA' ? 'Recogida: ' + r.addr : 'Lleva al laboratorio'}${r.hora ? ' · ' + r.hora : ''}`)),
    canCancel && h('button', { class: 'btn sm d', type: 'button', onclick: () => { if (confirm('¿Cancelar esta solicitud?')) api(`/api/requests/${r.id}/cancel`, { method: 'POST' }).then(() => { toast('Solicitud cancelada'); go('envios'); }).catch(e => toast(e.message)); } }, 'Cancelar')),
    h('div', { class: 'tblw' }, h('table', { class: 'tbl stk' }, h('thead', {}, h('tr', {}, ['N.º muestra', 'Paciente', 'Exámenes', 'Estado y resultado'].map(x => h('th', {}, x)))), h('tbody', {}, rows))), r.notes && h('p', { class: 'small muted' }, 'Observaciones: ' + r.notes),
    h('div', { class: 'sub' }, h('h3', {}, 'Documentos'), h('span', { class: 'row' }, uploader({ requestId: r.id, kind: 'attachment', label: '＋ Adjuntar PDF o foto', lab, onDone: () => setTimeout(fill, 1500) }))), docs,
    h('details', { style: 'margin-top:8px' }, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Historial'), timeline(r)));
  const fill = async () => { try { const { items } = await api(`/api/documents?requestId=${r.id}&pageSize=50`, { lab }); docs.textContent = ''; const gen = items.filter(d => d.kind !== 'lab_result_pdf');
    for (const [pid, cell] of pats) { cell.querySelectorAll('.doc').forEach(x => x.remove()); for (const d of items.filter(d => d.kind === 'lab_result_pdf' && d.patientId === pid)) { cell.append(docRow(d, lab)); if (!seen().has(d.id)) onNew?.(1); } }
    if (!gen.length) docs.append(h('p', { class: 'small muted', style: 'margin:0' }, 'Sin otros documentos.')); gen.forEach(d => docs.append(docRow(d, lab))); } catch (e) { docs.textContent = e.message; } };
  fill(); return card;
}

/* ---- nueva solicitud (varios pacientes, como en el laboratorio) ---- */
const blankPat = () => ({ name: '', species: 'canino', sex: '', breed: '', age: '', owner: '', phone: '', urg: false, obs: '', serviceIds: [] });
VIEWS.nueva = async m => {
  const labs = (await myLabs()).filter(l => l.status === 'approved'); m.textContent = '';
  if (!labs.length) { put(m, head('Nueva solicitud'), h('div', { class: 'card' }, h('h2', {}, 'Aún no tiene laboratorios aprobados'), h('p', {}, 'Únase a un laboratorio con su código de invitación o espere a que lo aprueben.'), h('button', { class: 'btn p', type: 'button', onclick: () => go('labs') }, 'Ir a Mis laboratorios'))); return; }
  const key = 'asv.draft.' + S.user.id, d = Object.assign({ labId: lsGet('asv.lab', labs[0].id), delivery: 'LAB', addr: '', hora: '', notes: '', pats: [blankPat()] }, lsGet(key, {}));
  if (!labs.some(l => l.id === d.labId)) d.labId = labs[0].id; if (!Array.isArray(d.pats) || !d.pats.length) d.pats = [blankPat()];
  const save = () => lsSet(key, d); let services = [];
  const total = h('span', { class: 'mono' }), upd = () => { total.textContent = cop(d.pats.reduce((a, p) => a + p.serviceIds.reduce((x, id) => x + (services.find(s => s.id === id)?.price || 0), 0), 0)); save(); };
  const labSel = h('select', {}, labs.map(l => h('option', { value: l.id, selected: l.id === d.labId }, l.name + (l.city ? ' · ' + l.city : ''))));
  const pbox = h('div'), msg = h('p', { class: 'err', role: 'alert' }), send = h('button', { class: 'btn p', type: 'button' }, 'Enviar solicitud');
  const loadSvc = async () => { pbox.textContent = 'Cargando el portafolio del laboratorio…'; services = (await api(`/api/labs/${d.labId}/services`)).services; S.services[d.labId] = services; d.pats.forEach(p => p.serviceIds = p.serviceIds.filter(id => services.some(s => s.id === id))); drawPats(); };
  function picker(p) {
    const box = h('div'), chips = h('div', { class: 'chips', style: 'margin:8px 0' }), q = h('input', { type: 'search', placeholder: `Buscar entre ${services.length} exámenes (ej. hemograma, renal, parvo)…` }), list = h('div', { class: 'svl' });
    const draw = () => { chips.textContent = ''; for (const id of p.serviceIds) { const s = services.find(x => x.id === id); if (s) chips.append(h('span', { class: 'chip' }, s.name, h('button', { type: 'button', 'aria-label': 'Quitar ' + s.name, onclick: () => { p.serviceIds = p.serviceIds.filter(x => x !== id); draw(); upd(); } }, '×'))); }
      if (!p.serviceIds.length) chips.append(h('span', { class: 'small muted' }, 'Aún no eligió exámenes.'));
      list.textContent = ''; const t = q.value.trim().toLowerCase(); let cat = '';
      for (const s of services.filter(s => !t || `${s.name} ${s.code} ${s.category}`.toLowerCase().includes(t))) { if (s.category !== cat) { cat = s.category; list.append(h('div', { class: 'cat' }, cat)); }
        list.append(h('label', {}, h('input', { type: 'checkbox', checked: p.serviceIds.includes(s.id), onchange: e => { e.target.checked ? p.serviceIds.push(s.id) : p.serviceIds = p.serviceIds.filter(x => x !== s.id); chips.textContent = ''; draw2(); upd(); } }), h('span', {}, s.name, h('span', { class: 'small muted', style: 'display:block' }, `${s.code} · entrega ~${s.turnaroundHours >= 48 ? Math.round(s.turnaroundHours / 24) + ' días' : s.turnaroundHours + ' h'}`)), h('span', { class: 'mono' }, cop(s.price)))); }
      if (!list.children.length) list.append(h('p', { class: 'muted', style: 'padding:10px;margin:0' }, 'Ningún examen coincide.')); };
    const draw2 = () => { const keep = list.scrollTop; draw(); list.scrollTop = keep; }; q.oninput = draw; draw(); put(box, chips, q, h('div', { style: 'height:6px' }), list); return box;
  }
  function drawPats() {
    pbox.textContent = ''; d.pats.forEach((p, i) => {
      const bind = (k, el) => { el.value = p[k] ?? ''; el.oninput = el.onchange = () => { p[k] = el.value; save(); }; return el; }, fld = (t, el) => h('label', { class: 'f' }, h('span', {}, t), el);
      const sp = bind('species', h('select', {}, ['canino', 'felino', 'equino', 'bovino', 'ovino', 'caprino', 'porcino', 'aviar', 'otro'].map(x => h('option', { value: x }, spLabel(x))))), sx = bind('sex', h('select', {}, ['', 'Macho', 'Hembra'].map(x => h('option', { value: x }, x || '—'))));
      put(pbox, h('div', { class: 'pcard' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('span', { class: 'pn' }, `Paciente ${i + 1}`),
        h('span', { class: 'row' }, h('label', { class: 'chk1' }, h('input', { type: 'checkbox', checked: p.urg, onchange: e => { p.urg = e.target.checked; save(); } }), 'Urgente'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => { d.pats.splice(i + 1, 0, { ...blankPat(), species: p.species, owner: p.owner, phone: p.phone, serviceIds: [...p.serviceIds] }); drawPats(); upd(); } }, 'Duplicar'),
          d.pats.length > 1 && h('button', { class: 'btn sm d', type: 'button', onclick: () => { d.pats.splice(i, 1); drawPats(); upd(); } }, 'Quitar'))),
        h('div', { class: 'grid' }, fld('Nombre *', bind('name', h('input', { autocomplete: 'off' }))), fld('Especie', sp), fld('Sexo', sx), fld('Raza', bind('breed', h('input'))), fld('Edad', bind('age', h('input', { placeholder: '4 años' }))), fld('Acudiente', bind('owner', h('input'))), fld('WhatsApp del acudiente', bind('phone', h('input', { type: 'tel', inputmode: 'tel' })))),
        h('label', { class: 'f', style: 'margin-top:10px' }, h('span', {}, 'Observaciones clínicas'), bind('obs', h('textarea', { maxlength: 500, placeholder: 'Signos, sospecha, medicación…' }))),
        h('div', { class: 'sub', style: 'margin-top:12px' }, h('h3', {}, 'Exámenes solicitados')), picker(p)));
    }); put(pbox, h('button', { class: 'btn', type: 'button', onclick: () => { d.pats.push(blankPat()); drawPats(); upd(); scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); } }, '＋ Agregar otro paciente')); upd();
  }
  labSel.onchange = () => { d.labId = labSel.value; lsSet('asv.lab', d.labId); d.pats.forEach(p => p.serviceIds = []); loadSvc().catch(e => pbox.textContent = e.message); };
  const dseg = h('div', { class: 'seg' }, [['LAB', 'Lo llevo al laboratorio'], ['RECOGIDA', 'Que lo recojan']].map(([k, n]) => h('button', { type: 'button', 'aria-pressed': d.delivery === k, onclick: () => { d.delivery = k; [...dseg.children].forEach((b, i) => b.setAttribute('aria-pressed', ['LAB', 'RECOGIDA'][i] === k)); addrF.hidden = k !== 'RECOGIDA'; save(); } }, n)));
  const addr = h('input', { value: d.addr, placeholder: 'Dirección de recogida', oninput: e => { d.addr = e.target.value; save(); } }), addrF = h('label', { class: 'f grow', hidden: d.delivery !== 'RECOGIDA' }, h('span', {}, 'Dirección de recogida *'), addr);
  send.onclick = () => busy(send, async () => { msg.textContent = '';
    try { const r = await api('/api/requests', { json: { labId: d.labId, delivery: d.delivery, addr: d.addr, hora: d.hora, notes: d.notes, patients: d.pats.map(p => ({ name: p.name, species: p.species, sex: p.sex, breed: p.breed, age: p.age, owner: p.owner, phone: p.phone, urg: p.urg, obs: p.obs, serviceIds: p.serviceIds })) } });
      localStorage.removeItem(key); toast(`Solicitud ${r.request.code} enviada a ${labName(d.labId)}`); go('envios'); } catch (e) { msg.textContent = e.message; scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); } });
  put(m, head('Nueva solicitud', `${S.user.name} · ${S.user.clinicName}`, h('button', { class: 'btn p', type: 'button', onclick: () => send.click() }, 'Enviar solicitud')),
    h('div', { class: 'card' }, h('div', { class: 'grid g2' }, h('label', { class: 'f' }, h('span', {}, 'Laboratorio'), labSel), h('label', { class: 'f' }, h('span', {}, 'Hora de la muestra (opcional)'), h('input', { type: 'time', value: d.hora, oninput: e => { d.hora = e.target.value; save(); } }))),
      h('div', { class: 'sub' }, h('h3', {}, 'Entrega de las muestras')), h('div', { class: 'row' }, dseg, addrF)), h('div', { style: 'height:12px' }), pbox,
    h('div', { class: 'card' }, h('label', { class: 'f' }, h('span', {}, 'Observaciones generales'), h('textarea', { maxlength: 1000, oninput: e => { d.notes = e.target.value; save(); } }, d.notes)), h('div', { class: 'tot' }, h('span', {}, 'Total estimado'), total), msg, h('button', { class: 'btn p wide', type: 'button', onclick: () => send.click() }, 'Enviar solicitud al laboratorio')));
  await loadSvc();
};

VIEWS.pacientes = async m => {
  await myLabs().catch(() => {}); const { patients } = await api('/api/vet/patients'); m.textContent = '';
  const q = h('input', { type: 'search', placeholder: 'Buscar paciente o acudiente…' }), box = h('div');
  const draw = () => { box.textContent = ''; const t = q.value.toLowerCase(); const L = patients.filter(p => `${p.name} ${p.owner || ''}`.toLowerCase().includes(t));
    if (!L.length) put(box, h('div', { class: 'card' }, h('p', { style: 'margin:0' }, patients.length ? 'Sin coincidencias.' : 'Sus pacientes aparecerán aquí cuando envíe solicitudes.')));
    for (const p of L) put(box, h('details', { class: 'card' }, h('summary', { style: 'cursor:pointer;list-style:none' }, h('b', {}, p.name), ' ', h('span', { class: 'pill' }, `${p.count} ${p.count === 1 ? 'envío' : 'envíos'}`), h('div', { class: 'small muted' }, [spLabel(p.species), p.sex, p.age, p.owner].filter(Boolean).join(' · '))),
      p.history.map(x => h('div', { class: 'doc' }, h('span', {}, h('b', { class: 'small' }, `${fday(x.date)} · ${x.code}${x.no ? ' · N.º ' + x.no : ''} · ${labName(x.labId)}`), h('div', { class: 'small' }, x.exams.join(', ')), x.why && h('div', { class: 'small', style: 'color:var(--crit)' }, 'Motivo: ' + x.why)), pill(PAT_ST, x.status), h('button', { class: 'btn sm', type: 'button', onclick: () => go('envios') }, 'Ver envíos'))))); };
  q.oninput = draw; put(m, head('Mis pacientes', 'Toque un paciente para ver lo enviado y su estado.'), h('div', { class: 'card', style: 'margin-bottom:12px' }, q), box); draw();
};
VIEWS.labs = async m => {
  await myLabs().catch(() => {}); const all = (await api('/api/labs')).labs; m.textContent = '';
  const sel = h('select', {}, all.map(l => h('option', { value: l.id }, l.name + (l.city ? ' · ' + l.city : '')))), code = h('input', { placeholder: 'Código de invitación (opcional)', autocapitalize: 'characters' }), msg = h('p', { class: 'err' });
  const ask = h('button', { class: 'btn p', type: 'button' }, 'Solicitar acceso'); ask.onclick = () => busy(ask, async () => { try { const r = await api(`/api/labs/${sel.value}/join`, { json: { code: code.value || undefined } }); toast(r.link.status === 'approved' ? 'Acceso aprobado' : 'Solicitud enviada; espere la aprobación del laboratorio', 4500); go('labs'); } catch (e) { msg.textContent = e.message; } });
  put(m, head('Mis laboratorios'), h('div', { class: 'card' }, S.labs.length ? S.labs.map(l => h('div', { class: 'doc' }, h('span', {}, h('b', {}, l.name), h('div', { class: 'small muted' }, l.city || '')), h('span', { class: 'pill ' + ({ approved: 'ok', pending: 'warn', blocked: 'crit' }[l.status]) }, { approved: 'Aprobado', pending: 'Pendiente', blocked: 'Bloqueado' }[l.status]))) : h('p', { class: 'muted', style: 'margin:0' }, 'Aún no se ha unido a ningún laboratorio.')),
    h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:8px' }, 'Solicitar acceso a un laboratorio'), h('div', { class: 'grid g2' }, h('label', { class: 'f' }, h('span', {}, 'Laboratorio'), sel), h('label', { class: 'f' }, h('span', {}, 'Con código queda aprobado al instante; sin código, el laboratorio debe aprobarlo'), code)), msg, ask));
};

/* =================== LABORATORIO =================== */
const isAdmin = () => S.user.role === 'lab_admin';
async function refreshCounts() { try { const s = await api('/api/lab/summary'); const c = $('#cntRec'); if (c) c.textContent = s.porRecibir || ''; return s; } catch { return null; } }

VIEWS.inicio = async m => {
  const s = await refreshCounts(); m.textContent = '';
  const tile = (n, t, cls, to) => h('button', { class: 'tile ' + cls, type: 'button', onclick: () => go(to) }, h('b', {}, n), h('span', {}, t));
  const rec = await api('/api/requests?pageSize=6'); const pend = s.veterinariosPendientes;
  put(m, head('Inicio', 'Resumen de hoy'), pend ? h('div', { class: 'banner' }, h('p', {}, h('b', {}, `${pend} ${pend === 1 ? 'veterinario espera' : 'veterinarios esperan'} su aprobación.`)), h('button', { class: 'btn p sm', type: 'button', onclick: () => go('remitentes') }, 'Revisar')) : null,
    h('div', { class: 'tiles' }, tile(s.porRecibir, 'Muestras por recibir', s.porRecibir ? 'warn' : '', 'recep'), tile(s.urgentes, 'Urgentes por recibir', s.urgentes ? 'crit' : '', 'recep'), tile(s.enProceso, 'En proceso', '', 'recep'), tile(s.entregadosHoy, 'Solicitudes finalizadas hoy', '', 'recep'), tile(s.solicitudes, 'Solicitudes en total', '', 'recep')),
    h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Últimas solicitudes'), h('button', { class: 'btn sm', type: 'button', onclick: () => go('recep') }, 'Ver todas')),
      rec.items.length ? rec.items.map(r => h('div', { class: 'doc' }, h('span', {}, h('b', {}, r.code), ' ', pill(REQ_ST, r.status), r.urg && !r.cancelled && h('span', { class: 'pill crit', style: 'margin-left:6px' }, 'Urgente'), h('div', { class: 'small muted' }, `${r.clinicName} · ${r.pats.map(p => p.name).join(', ')} · ${fdate(r.createdAt)}`)), h('button', { class: 'btn sm', type: 'button', onclick: () => go('recep') }, 'Abrir'))) : h('p', { class: 'muted', style: 'margin:0' }, 'Todavía no hay solicitudes. Entregue el código de invitación a sus veterinarios en «Remitentes».')));
  poll(() => VIEWS.inicio(m).catch(() => {}), 30000);
};

VIEWS.recep = async m => {
  const f = { st: h('select', {}, h('option', { value: '' }, 'Todos los estados'), Object.entries(REQ_ST).map(([k, v]) => h('option', { value: k }, v[0]))), q: h('input', { type: 'search', placeholder: 'Buscar paciente, clínica, N.º o código…' }), from: h('input', { type: 'date', title: 'Desde' }), to: h('input', { type: 'date', title: 'Hasta' }) };
  const list = h('div'), qs = () => new URLSearchParams({ status: f.st.value, q: f.q.value, from: f.from.value, to: f.to.value }).toString(); let known = null;
  const load = async (quiet) => { const r = await api('/api/requests?pageSize=50&' + qs()); const s = await refreshCounts(); const ids = new Set(r.items.map(x => x.id));
    if (known && [...ids].some(id => !known.has(id))) { toast('🔔 Llegó una solicitud nueva'); } known = ids; list.textContent = '';
    if (!r.items.length) list.append(h('div', { class: 'card' }, h('p', { style: 'margin:0' }, 'No hay solicitudes con ese filtro.')));
    for (const x of r.items) list.append(labCard(x, () => load(true)));
    if (s) document.title = (s.porRecibir ? `(${s.porRecibir}) ` : '') + ($('#sub')?.textContent || 'AsisVet'); };
  m.textContent = ''; put(m, head('Recepción', 'Reciba cada muestra, suba el resultado y entréguelo al veterinario.', exportBtns(qs)), h('div', { class: 'card', style: 'margin-bottom:12px' }, h('div', { class: 'grid' }, f.st, f.q, f.from, f.to)), list);
  [f.st, f.from, f.to].forEach(e => e.onchange = () => load()); f.q.oninput = () => { clearTimeout(f.t); f.t = setTimeout(load, 250); }; await load(); poll(() => load(true), 10000);
};
function labCard(r, reload) {
  const card = h('div', { class: 'card' }), docs = new Map(), nodes = new Map();
  const act = (p, body, ok) => api(`/api/requests/${r.id}/patients/${p.id}/status`, { json: body }).then(() => { toast(ok); reload(); }).catch(e => toast(e.message, 5000));
  const receive = p => { const rot = h('input', { type: 'checkbox', checked: true }), frio = h('input', { type: 'checkbox', checked: true }); const ok = h('button', { class: 'btn p wide', type: 'button' }, 'Recibir muestra');
    const o = overlay([h('h2', {}, `Recibir: ${p.name}`), h('p', { class: 'small muted' }, 'Revise la muestra al recibirla. Se le asignará un número de muestra.'), h('label', { class: 'chk1', style: 'display:flex;margin:8px 0' }, rot, 'Rotulado correcto'), h('label', { class: 'chk1', style: 'display:flex;margin:8px 0 14px' }, frio, 'Llegó en cadena de frío / buen estado'), ok, h('button', { class: 'btn wide', type: 'button', style: 'margin-top:8px', onclick: () => o.close() }, 'Cancelar')]);
    ok.onclick = () => busy(ok, async () => { await act(p, { status: 'rec', checks: { rot: rot.checked, frio: frio.checked } }, `Muestra recibida: ${p.name}`); o.close(); }); };
  const reject = p => { const why = h('textarea', { maxlength: 300, placeholder: 'Ej. muestra coagulada, volumen insuficiente, sin rotular…' }), ok = h('button', { class: 'btn p wide', type: 'button' }, 'Rechazar muestra'), er = h('p', { class: 'err' });
    const o = overlay([h('h2', {}, `Rechazar: ${p.name}`), h('p', { class: 'small muted' }, 'El veterinario verá este motivo en su portal.'), h('label', { class: 'f' }, h('span', {}, 'Motivo *'), why), er, ok, h('button', { class: 'btn wide', type: 'button', style: 'margin-top:8px', onclick: () => o.close() }, 'Volver')]);
    ok.onclick = () => busy(ok, async () => { if (!why.value.trim()) { er.textContent = 'Escriba el motivo.'; return; } await act(p, { status: 'rej', note: why.value }, 'Muestra rechazada'); o.close(); }); };
  const rows = r.pats.map(p => { const a = h('div', { class: 'row', style: 'margin-top:6px' }), dz = h('div'); docs.set(p.id, dz);
    if (!r.cancelled) { if (p.st === 'pend') a.append(h('button', { class: 'btn sm p', type: 'button', onclick: () => receive(p) }, 'Recibir'), h('button', { class: 'btn sm d', type: 'button', onclick: () => reject(p) }, 'Rechazar'));
      if (p.st === 'rec') { a.append(...uploader({ requestId: r.id, patientId: p.id, kind: 'lab_result_pdf', label: '⬆ Subir resultado (PDF)', onDone: () => setTimeout(fill, 2000) }), h('button', { class: 'btn sm p', type: 'button', onclick: () => act(p, { status: 'done' }, `Resultado entregado: ${p.name}`) }, 'Entregar al veterinario'), h('button', { class: 'btn sm d', type: 'button', onclick: () => reject(p) }, 'Rechazar')); } }
    const cell = h('td', { 'data-l': 'Estado' }, pill(PAT_ST, p.st), p.chk && (!p.chk.rot || !p.chk.frio) && h('div', { class: 'small', style: 'color:var(--warn)' }, [!p.chk.rot && 'Sin rotular', !p.chk.frio && 'Sin cadena de frío'].filter(Boolean).join(' · ')), p.why && h('div', { class: 'small', style: 'color:var(--crit)' }, 'Motivo: ' + p.why), a, dz); nodes.set(p.id, cell);
    return h('tr', {}, h('td', { class: 'mono', 'data-l': 'N.º muestra' }, p.no || '—'), h('td', { 'data-l': 'Paciente' }, h('b', {}, p.name), p.urg && h('span', { class: 'pill crit', style: 'margin-left:6px' }, 'Urgente'), h('div', { class: 'small muted' }, [spLabel(p.species), p.sex, p.age, p.owner && 'Acud.: ' + p.owner].filter(Boolean).join(' · ')), p.phone && h('div', { class: 'small muted' }, 'WhatsApp ' + p.phone), p.obs && h('div', { class: 'small' }, p.obs)), h('td', { 'data-l': 'Exámenes' }, p.items.map(i => i.name).join(', ')), cell); });
  put(card, h('div', { class: 'card-h' }, h('div', {}, h('h2', {}, r.code, ' ', pill(REQ_ST, r.status), r.urg && !r.cancelled && h('span', { class: 'pill crit', style: 'margin-left:6px' }, 'Urgente')), h('div', { class: 'small muted', style: 'margin-top:4px' }, `${r.clinicName}${r.clinicPhone ? ' · ' + r.clinicPhone : ''} · ${fdate(r.createdAt)}`), h('div', { class: 'small', style: 'margin-top:2px' }, r.delivery === 'RECOGIDA' ? '🚗 Recoger en: ' + r.addr : '🏥 El veterinario la lleva al laboratorio', r.hora && ' · ' + r.hora)), h('div', { class: 'mono', style: 'font-weight:600' }, cop(r.total))),
    r.notes && h('p', { class: 'small', style: 'margin:0 0 8px' }, 'Observaciones: ' + r.notes), h('div', { class: 'tblw' }, h('table', { class: 'tbl stk' }, h('thead', {}, h('tr', {}, ['N.º muestra', 'Paciente', 'Exámenes', 'Estado'].map(x => h('th', {}, x)))), h('tbody', {}, rows))),
    h('details', { style: 'margin-top:8px' }, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Historial'), timeline(r)));
  const fill = async () => { try { const { items } = await api(`/api/documents?requestId=${r.id}&pageSize=50`); for (const [pid, dz] of docs) { dz.textContent = ''; items.filter(d => d.kind === 'lab_result_pdf' && d.patientId === pid).forEach(d => dz.append(docRow(d))); }
    const other = items.filter(d => d.kind !== 'lab_result_pdf'); if (other.length) put(card, h('div', { class: 'sub' }, h('h3', {}, 'Documentos de la solicitud')), other.map(d => docRow(d))); } catch {} };
  fill(); return card;
}

VIEWS.remitentes = async m => {
  const [{ vets }, cfg] = await Promise.all([api('/api/lab/vets'), api('/api/lab/settings')]); m.textContent = '';
  const code = h('b', { class: 'mono', style: 'font-size:24px;letter-spacing:.12em' }, cfg.inviteCode);
  const set = (id, st) => api(`/api/lab/vets/${id}/status`, { json: { status: st } }).then(() => { toast(st === 'approved' ? 'Veterinario aprobado' : 'Acceso actualizado'); go('remitentes'); }).catch(e => toast(e.message));
  const st = { approved: ['Aprobado', 'ok'], pending: ['Pendiente', 'warn'], blocked: ['Bloqueado', 'crit'] };
  put(m, head('Remitentes', 'Veterinarios que envían muestras a su laboratorio.'),
    h('div', { class: 'card' }, h('h2', {}, 'Código de invitación'), h('p', { class: 'small muted' }, 'Quien se registre con este código queda aprobado al instante. Sin código, usted aprueba manualmente.'), h('div', { class: 'row' }, code, h('button', { class: 'btn sm', type: 'button', onclick: () => navigator.clipboard?.writeText(cfg.inviteCode).then(() => toast('Código copiado')) }, 'Copiar'),
      isAdmin() && h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (confirm('El código anterior dejará de funcionar. ¿Continuar?')) { code.textContent = (await api('/api/lab/invite', { method: 'POST' })).inviteCode; toast('Código nuevo generado'); } } }, 'Generar uno nuevo'))),
    h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:8px' }, `Veterinarios (${vets.length})`), vets.length ? h('div', { class: 'tblw' }, h('table', { class: 'tbl stk' }, h('thead', {}, h('tr', {}, ['Veterinaria', 'Contacto', 'Ciudad', 'Estado', ''].map(x => h('th', {}, x)))),
      h('tbody', {}, vets.map(v => h('tr', {}, h('td', { 'data-l': 'Veterinaria' }, h('b', {}, v.clinicName || '—'), h('div', { class: 'small muted' }, v.name)), h('td', { 'data-l': 'Contacto' }, v.email, v.phone && h('div', { class: 'small muted' }, v.phone)), h('td', { 'data-l': 'Ciudad' }, v.city || '—'), h('td', { 'data-l': 'Estado' }, h('span', { class: 'pill ' + st[v.status][1] }, st[v.status][0])),
        h('td', { class: 'n' }, isAdmin() && h('span', { class: 'row', style: 'justify-content:flex-end' }, v.status !== 'approved' && h('button', { class: 'btn sm p', type: 'button', onclick: () => set(v.vetId, 'approved') }, 'Aprobar'), v.status !== 'blocked' && h('button', { class: 'btn sm d', type: 'button', onclick: () => set(v.vetId, 'blocked') }, 'Bloquear')))))))) : h('p', { class: 'muted', style: 'margin:0' }, 'Aún no hay veterinarios. Comparta su código de invitación.')));
};

VIEWS.portafolio = async m => {
  const { services } = await api(`/api/labs/${S.user.labId}/services`); m.textContent = '';
  const q = h('input', { type: 'search', placeholder: 'Buscar examen…' }), body = h('tbody'), admin = isAdmin();
  const row = (s, isNew) => { const e = { code: h('input', { value: s.code || '', style: 'min-width:70px', 'aria-label': 'Código' }), name: h('input', { value: s.name || '', style: 'min-width:180px', 'aria-label': 'Examen' }), cat: h('input', { value: s.category || 'General', 'aria-label': 'Categoría' }), hrs: h('input', { type: 'number', min: 0, value: s.turnaroundHours ?? 24, style: 'width:80px', 'aria-label': 'Horas' }), price: h('input', { type: 'number', min: 0, value: s.price ?? 0, style: 'width:110px', 'aria-label': 'Precio' }), act: h('input', { type: 'checkbox', checked: s.active !== false, 'aria-label': 'Activo' }) };
    const save = h('button', { class: 'btn sm p', type: 'button' }, isNew ? 'Agregar' : 'Guardar'); save.onclick = () => busy(save, async () => { try { await api(s.id ? `/api/lab/services/${s.id}` : '/api/lab/services', { method: s.id ? 'PUT' : 'POST', json: { code: e.code.value, name: e.name.value, category: e.cat.value, sampleType: s.sampleType, turnaroundHours: +e.hrs.value, price: +e.price.value, active: e.act.checked } }); toast(isNew ? 'Examen agregado' : 'Guardado'); if (isNew) go('portafolio'); } catch (x) { toast(x.message, 5000); } });
    const dis = !admin; Object.values(e).forEach(x => x.disabled = dis);
    return h('tr', { 'data-s': `${s.name} ${s.code} ${s.category}`.toLowerCase() }, h('td', { 'data-l': 'Código' }, e.code), h('td', { 'data-l': 'Examen' }, e.name), h('td', { 'data-l': 'Categoría' }, e.cat), h('td', { 'data-l': 'Horas' }, e.hrs), h('td', { 'data-l': 'Precio COP' }, e.price), h('td', { 'data-l': 'Activo' }, e.act), h('td', { class: 'n' }, admin && save)); };
  const draw = () => { const t = q.value.toLowerCase(); body.querySelectorAll('tr').forEach(tr => tr.hidden = t && !tr.dataset.s.includes(t)); };
  services.forEach(s => body.append(row(s))); q.oninput = draw;
  const table = rows => h('div', { class: 'tblw' }, h('table', { class: 'tbl stk' }, h('thead', {}, h('tr', {}, ['Código', 'Examen', 'Categoría', 'Horas', 'Precio COP', 'Activo', ''].map(x => h('th', {}, x)))), rows));
  put(m, head('Portafolio de servicios', `${services.length} exámenes. Es lo que ve el veterinario al elegir su laboratorio; un cambio de precio no afecta solicitudes ya enviadas.`), h('div', { class: 'card', style: 'margin-bottom:12px' }, q), h('div', { class: 'card' }, table(body)),
    admin && h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:8px' }, 'Agregar examen'), table(h('tbody', {}, row({}, true)))));
};

VIEWS.ajustes = async m => {
  const cfg = await api('/api/lab/settings'); m.textContent = '';
  const st = { name: h('input', { autocomplete: 'name' }), email: h('input', { type: 'email', autocapitalize: 'none' }), pw: h('input', { type: 'password', autocomplete: 'new-password' }) }, msg = h('p', { class: 'err' }), add = h('button', { class: 'btn p', type: 'button' }, 'Crear usuario');
  add.onclick = () => busy(add, async () => { try { await api('/api/lab/staff', { json: { name: st.name.value, email: st.email.value, password: st.pw.value } }); msg.className = 'okt'; msg.textContent = 'Usuario creado. Puede ingresar con ese correo y contraseña.'; Object.values(st).forEach(x => x.value = ''); } catch (e) { msg.className = 'err'; msg.textContent = e.message; } });
  const fld = (t, el) => h('label', { class: 'f' }, h('span', {}, t), el);
  put(m, head('Ajustes'), h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:6px' }, cfg.name), h('p', { class: 'small muted', style: 'margin:0' }, [cfg.city, cfg.phone, cfg.nit && 'NIT ' + cfg.nit].filter(Boolean).join(' · ') || 'Sin más datos registrados.')),
    h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:8px' }, 'Agregar personal del laboratorio'), h('div', { class: 'grid' }, fld('Nombre', st.name), fld('Correo', st.email), fld('Contraseña (mín. 8)', st.pw)), msg, add),
    h('div', { class: 'card' }, h('h2', {}, 'Apariencia'), h('p', { class: 'small muted', style: 'margin:2px 0 0' }, 'Modo claro/oscuro y paleta de colores. Se recuerda en este dispositivo.'), appearance()));
};
boot();
