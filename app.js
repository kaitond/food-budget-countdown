/* =========================================================
   食費カウントダウン
   - 端末内保存（localStorage）で常に即動作
   - 共有コードを持つ端末どうしはクラウド経由でリアルタイム同期
   ========================================================= */

/* ---------- Supabase 接続情報（anon キーは公開前提。RLS で保護） ---------- */
const SB_URL = 'https://tgmzwzmvzrcxnkqzoicd.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnbXp3em12enJjeG5rcXpvaWNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3NDgxNDcsImV4cCI6MjEwMjMyNDE0N30.PzPrVCmmK3TND6fiv-mFfRHWwqumrlVcOHIAfr-ztA0';

/* ---------- 定数 ---------- */
const KEY = 'foodBudget.v1';
const CATS = [
  { id: 'super', name: 'スーパー', icon: '🛒' },
  { id: 'conv',  name: 'コンビニ', icon: '🏪' },
  { id: 'eat',   name: '外食',     icon: '🍜' },
  { id: 'cafe',  name: 'カフェ',   icon: '☕' },
  { id: 'deli',  name: '惣菜・弁当', icon: '🍱' },
  { id: 'other', name: 'その他',   icon: '🧺' },
];
const DEF = { budget: 40000, mode: 'date', carry: false, items: [], hh: null, who: '', setUpdated: 0 };
const WD = ['日', '月', '火', '水', '木', '金', '土'];

let S = load();
let cursor = new Date();
let curCat = 'super';
let curPhoto = null;      // {thumb, full}
let sb = null, ch = null, pulling = false;

/* ---------- 保存・読込 ---------- */
function load() {
  let d;
  try { d = Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (e) { d = Object.assign({}, DEF); }
  // 旧データ（数値ID）を UUID に移行
  for (const it of d.items) {
    if (typeof it.id !== 'string') { it.id = uuid(); it.dirty = true; }
    if (!it.updated_at) it.updated_at = new Date(0).toISOString();
    if (it.photo && !it.thumb) it.thumb = it.photo;
  }
  return d;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) {
    // 容量オーバー時は同期済みの写真を捨てて再挑戦
    if (S.hh) { for (const it of S.items) if (!it.dirty) delete it.photo; }
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e2) { toast('保存できませんでした（ブラウザの容量不足）'); }
  }
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    }));

/* ---------- 日付ユーティリティ ---------- */
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysInMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const sameDay = (a, b) => ymd(a) === ymd(b);

const live = () => S.items.filter(i => !i.deleted);
const dayBudget = d => S.budget / daysInMonth(d);

function weekRange(d) {
  if (S.mode === 'date') {
    const last = daysInMonth(d);
    const start = Math.floor((d.getDate() - 1) / 7) * 7 + 1;
    const end = Math.min(start + 6, last);
    return { s: new Date(d.getFullYear(), d.getMonth(), start), e: new Date(d.getFullYear(), d.getMonth(), end) };
  }
  const base = S.mode === 'mon' ? 1 : 0;
  const s = addDays(d, -((d.getDay() - base + 7) % 7));
  return { s, e: addDays(s, 6) };
}
function eachDay(r) { const o = []; for (let x = new Date(r.s); x <= r.e; x = addDays(x, 1)) o.push(new Date(x)); return o; }
function weekLabel(r) {
  const m = r.s.getMonth() + 1;
  return S.mode === 'date' ? `${m}月 第${Math.floor((r.s.getDate() - 1) / 7) + 1}週` : `${m}月${r.s.getDate()}日の週`;
}

/* ---------- 集計 ---------- */
const spentOn = d => live().filter(i => i.date === ymd(d)).reduce((a, b) => a + b.amount, 0);
const sumRange = r => eachDay(r).reduce((a, d) => a + spentOn(d), 0);
const budgetRange = r => eachDay(r).reduce((a, d) => a + dayBudget(d), 0);
function carryOver(r) {
  if (!S.carry) return 0;
  let c = 0;
  for (let day = 1; day < r.s.getDate(); day++) {
    const d = new Date(r.s.getFullYear(), r.s.getMonth(), day);
    c += dayBudget(d) - spentOn(d);
  }
  return c;
}

/* ---------- 描画 ---------- */
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function render() {
  const r = weekRange(cursor), today = new Date(), days = eachDay(r);

  wTitle.textContent = weekLabel(r);
  wRange.textContent = `${r.s.getMonth() + 1}/${r.s.getDate()}(${WD[r.s.getDay()]}) 〜 ${r.e.getMonth() + 1}/${r.e.getDate()}(${WD[r.e.getDay()]})`;

  const budget = budgetRange(r), carry = carryOver(r), used = sumRange(r);
  const total = budget + carry, rest = total - used;
  const color = rest < 0 ? 'var(--ng)' : (rest < total * 0.2 ? 'var(--warn)' : 'var(--ok)');

  const el = document.getElementById('remain');
  el.innerHTML = (rest < 0 ? '<span class="yen">−¥</span>' : '<span class="yen">¥</span>')
    + Math.round(Math.abs(rest)).toLocaleString();
  el.style.color = color;

  barFill.style.width = (total > 0 ? Math.min(100, used / total * 100) : 0) + '%';
  barFill.style.background = color;
  usedTxt.textContent = '使った ¥' + Math.round(used).toLocaleString();
  budgetTxt.textContent = '週予算 ¥' + Math.round(budget).toLocaleString()
    + (carry ? (carry > 0 ? ' +繰越 ¥' : ' −繰越 ¥') + Math.round(Math.abs(carry)).toLocaleString() : '');

  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let left = today > r.e ? 0 : (today < r.s ? days.length : days.filter(d => d >= t0).length);
  daysLeft.textContent = left + '日';
  perDay.textContent = left > 0 ? '¥' + Math.round(Math.max(0, rest) / left).toLocaleString() : '—';
  remainSub.textContent = rest < 0
    ? `週予算を ¥${Math.round(-rest).toLocaleString()} オーバー中`
    : (left > 0 ? `残り${left}日 ／ 1日 ¥${Math.round(rest / left).toLocaleString()} ペース` : 'この週は終了しました');

  const mUsed = sumRange({ s: new Date(cursor.getFullYear(), cursor.getMonth(), 1), e: new Date(cursor.getFullYear(), cursor.getMonth(), daysInMonth(cursor)) });
  monthLeft.textContent = '¥' + Math.round(S.budget - mUsed).toLocaleString();
  monthLeft.style.color = (S.budget - mUsed) < 0 ? 'var(--ng)' : 'var(--text)';

  const max = Math.max(dayBudget(r.s) * 1.2, ...days.map(spentOn), 1);
  dayBars.innerHTML = days.map(d => {
    const v = spentOn(d), h = Math.max(3, v / max * 52);
    const cls = v === 0 ? '' : (v > dayBudget(d) ? 'over' : 'has');
    return `<div class="day ${sameDay(d, today) ? 'today' : ''}">
      <div class="col ${cls}" style="height:${h}px"></div><div class="d">${d.getDate()}</div></div>`;
  }).join('');

  const items = live()
    .filter(i => i.date >= ymd(r.s) && i.date <= ymd(r.e))
    .sort((a, b) => a.date === b.date ? String(b.updated_at).localeCompare(String(a.updated_at)) : b.date.localeCompare(a.date));
  cnt.textContent = items.length ? `(${items.length}件)` : '';
  if (!items.length) { list.innerHTML = '<div class="empty">まだ入力がありません</div>'; }
  else {
    let html = '', lastDate = '';
    for (const it of items) {
      if (it.date !== lastDate) {
        const d = parse(it.date);
        html += `<div class="dayhead">${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})　¥${spentOn(d).toLocaleString()}</div>`;
        lastDate = it.date;
      }
      const c = CATS.find(c => c.id === it.cat) || CATS[5];
      const th = it.thumb || it.photo;
      html += `<div class="item">
        <div class="ic">${th ? `<img src="${th}" data-view="${it.id}">` : c.icon}</div>
        <div class="m"><b>${it.memo ? esc(it.memo) : c.name}</b>
          <small>${c.name}${it.who ? ' ・ ' + esc(it.who) : ''}${it.dirty ? ' ・ 未同期' : ''}</small></div>
        <div class="p">¥${it.amount.toLocaleString()}</div>
        <button class="x" data-del="${it.id}">✕</button>
      </div>`;
    }
    list.innerHTML = html;
  }
  paintStatus();
}

/* ---------- 同期ステータス表示 ---------- */
function paintStatus() {
  const n = S.items.filter(i => i.dirty).length;
  if (!S.hh) { badge.className = 'badge'; badge.textContent = 'この端末のみ'; return; }
  if (!navigator.onLine) { badge.className = 'badge off'; badge.textContent = 'オフライン' + (n ? ` (${n}件待ち)` : ''); return; }
  badge.className = 'badge on';
  badge.textContent = n ? `同期中… (${n})` : '共有中';
}
let toastT;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
}

/* =========================================================
   クラウド同期
   ========================================================= */
function connect() {
  if (!S.hh || typeof supabase === 'undefined') return null;
  sb = supabase.createClient(SB_URL, SB_KEY, {
    global: { headers: { 'x-hh-code': S.hh.code } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  subscribe();
  return sb;
}
function subscribe() {
  if (!sb || !S.hh) return;
  if (ch) { try { sb.removeChannel(ch); } catch (e) {} ch = null; }
  ch = sb.channel('hh-' + S.hh.id)
    .on('broadcast', { event: 'sync' }, () => pull())
    .subscribe();
}
const ping = () => { try { ch && ch.send({ type: 'broadcast', event: 'sync', payload: {} }); } catch (e) {} };

/* 未送信ぶんをまとめて送る */
async function push() {
  if (!sb || !S.hh || !navigator.onLine) return;
  const dirty = S.items.filter(i => i.dirty);
  if (!dirty.length) return;
  const rows = dirty.map(i => ({
    id: i.id, household_id: S.hh.id, date: i.date, amount: i.amount,
    cat: i.cat, memo: i.memo || '', who: i.who || '',
    photo_thumb: i.thumb || null, photo: i.photo || null, deleted: !!i.deleted,
  }));
  const { error } = await sb.from('entries').upsert(rows);
  if (error) { console.warn('push', error.message); return; }
  for (const i of dirty) {
    delete i.dirty;
    delete i.photo;               // 本体はサーバー保管。表示はサムネ、拡大時に取得
  }
  save(); render(); ping();
}

/* サーバーの内容を取り込む */
async function pull() {
  if (!sb || !S.hh || pulling || !navigator.onLine) return;
  pulling = true;
  try {
    const from = ymd(addDays(new Date(), -400));
    const [ent, hh] = await Promise.all([
      sb.from('entries').select('id,date,amount,cat,memo,who,photo_thumb,deleted,updated_at').gte('date', from),
      sb.from('households').select('budget,mode,carry,updated_at').eq('id', S.hh.id).maybeSingle(),
    ]);
    if (ent.error) throw ent.error;
    if (ent.data) {
      const byId = new Map(S.items.map(i => [i.id, i]));
      for (const row of ent.data) {
        const local = byId.get(row.id);
        if (local && (local.dirty || String(local.updated_at) >= String(row.updated_at))) continue;
        const merged = {
          id: row.id, date: row.date, amount: row.amount, cat: row.cat, memo: row.memo || '',
          who: row.who || '', thumb: row.photo_thumb || null, deleted: !!row.deleted,
          updated_at: row.updated_at,
        };
        if (local) Object.assign(local, merged); else S.items.push(merged);
      }
    }
    if (hh.data && !hh.error) {
      const remote = new Date(hh.data.updated_at).getTime();
      if (remote > (S.setUpdated || 0)) {
        S.budget = hh.data.budget; S.mode = hh.data.mode; S.carry = hh.data.carry; S.setUpdated = remote;
      }
    }
    save(); render();
  } catch (e) { console.warn('pull', e.message || e); }
  finally { pulling = false; }
}

async function pushSettings() {
  if (!sb || !S.hh || !navigator.onLine) return;
  const { data, error } = await sb.from('households')
    .update({ budget: S.budget, mode: S.mode, carry: S.carry })
    .eq('id', S.hh.id).select('updated_at').maybeSingle();
  if (!error && data) { S.setUpdated = new Date(data.updated_at).getTime(); save(); }
  ping();
}

/* 共有をはじめる（世帯を作る） */
async function createHousehold() {
  if (typeof supabase === 'undefined') { toast('通信ライブラリを読み込めませんでした'); return false; }
  const code = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const tmp = supabase.createClient(SB_URL, SB_KEY, { global: { headers: { 'x-hh-code': code } }, auth: { persistSession: false } });
  const { data, error } = await tmp.from('households')
    .insert({ code, budget: S.budget, mode: S.mode, carry: S.carry }).select('id,updated_at').single();
  if (error) { toast('共有の開始に失敗：' + error.message); return false; }
  S.hh = { code, id: data.id };
  S.setUpdated = new Date(data.updated_at).getTime();
  for (const i of S.items) i.dirty = true;      // 手元の記録を共有先へ移す
  save(); connect(); await push(); render();
  return true;
}

/* 共有に参加する */
async function joinHousehold(code, keepLocal) {
  code = (code || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (code.length < 16) { toast('コードの形式が違います'); return false; }
  const tmp = supabase.createClient(SB_URL, SB_KEY, { global: { headers: { 'x-hh-code': code } }, auth: { persistSession: false } });
  const { data, error } = await tmp.from('households').select('id,budget,mode,carry,updated_at').maybeSingle();
  if (error) { toast('接続に失敗：' + error.message); return false; }
  if (!data) { toast('そのコードの共有は見つかりません'); return false; }
  S.hh = { code, id: data.id };
  S.budget = data.budget; S.mode = data.mode; S.carry = data.carry;
  S.setUpdated = new Date(data.updated_at).getTime();
  if (keepLocal) { for (const i of S.items) i.dirty = true; } else { S.items = []; }
  save(); connect(); await push(); await pull(); render();
  return true;
}

function leaveHousehold() {
  if (ch && sb) { try { sb.removeChannel(ch); } catch (e) {} }
  ch = null; sb = null; S.hh = null;
  for (const i of S.items) delete i.dirty;
  save(); render();
}

/* 拡大表示用に写真の本体を取りに行く */
async function fetchPhoto(id) {
  const local = S.items.find(i => i.id === id);
  if (local && local.photo) return local.photo;
  if (!sb) return local ? local.thumb : null;
  const { data } = await sb.from('entries').select('photo').eq('id', id).maybeSingle();
  return (data && data.photo) || (local && local.thumb) || null;
}

/* =========================================================
   画面イベント
   ========================================================= */
cats.innerHTML = CATS.map(c => `<div class="chip ${c.id === curCat ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${c.name}</div>`).join('');
cats.onclick = e => {
  const t = e.target.closest('[data-cat]'); if (!t) return;
  curCat = t.dataset.cat;
  [...cats.children].forEach(c => c.classList.toggle('on', c.dataset.cat === curCat));
};
inDate.value = ymd(new Date());
inAmount.addEventListener('input', () => { btnAdd.disabled = !(Number(inAmount.value) > 0); });

/* レシート写真：一覧用サムネ＋拡大用の2枚を作る */
function shrink(img, px, q) {
  const sc = Math.min(1, px / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', q);
}
inPhoto.onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    curPhoto = { thumb: shrink(img, 160, 0.5), full: shrink(img, 900, 0.6) };
    URL.revokeObjectURL(img.src);
    attachLabel.classList.add('hasimg');
    attachTxt.textContent = '✓ レシートを添付しました（タップで変更）';
  };
  img.src = URL.createObjectURL(f);
};

btnAdd.onclick = () => {
  const a = Math.round(Number(inAmount.value));
  if (!(a > 0)) return;
  S.items.push({
    id: uuid(), date: inDate.value || ymd(new Date()), amount: a, cat: curCat,
    memo: inMemo.value.trim(), who: S.who || '', thumb: curPhoto && curPhoto.thumb,
    photo: curPhoto && curPhoto.full, deleted: false,
    updated_at: new Date().toISOString(), dirty: true,
  });
  save();
  cursor = parse(inDate.value || ymd(new Date()));
  inAmount.value = ''; inMemo.value = ''; curPhoto = null;
  attachLabel.classList.remove('hasimg'); attachTxt.textContent = '📷 レシート写真を添付（任意）'; inPhoto.value = '';
  btnAdd.disabled = true;
  render(); push();
};

list.onclick = async e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    if (!confirm('この記録を削除しますか？')) return;
    const it = S.items.find(i => i.id === del.dataset.del);
    if (it) { it.deleted = true; it.updated_at = new Date().toISOString(); it.dirty = true; }
    save(); render(); push();
    return;
  }
  const v = e.target.closest('[data-view]');
  if (v) {
    viewerImg.src = v.src; viewer.classList.add('on');
    const full = await fetchPhoto(v.dataset.view);
    if (full && viewer.classList.contains('on')) viewerImg.src = full;
  }
};
viewer.onclick = () => viewer.classList.remove('on');

prevW.onclick = () => { cursor = addDays(weekRange(cursor).s, -1); render(); };
nextW.onclick = () => { cursor = addDays(weekRange(cursor).e, 1); render(); };

/* ---------- 設定シート ---------- */
btnSet.onclick = () => { openSheet(); };
function openSheet() {
  setBudget.value = S.budget;
  setMode.value = S.mode;
  setCarry.classList.toggle('on', S.carry);
  setWho.value = S.who || '';
  shareLocal.style.display = S.hh ? 'none' : '';
  shareOn.style.display = S.hh ? '' : 'none';
  if (S.hh) { codeText.textContent = maskCode(S.hh.code); codeText.dataset.shown = ''; }
  mask.classList.add('on');
}
const maskCode = c => c.slice(0, 4) + '••••••••••••••••••••••••' + c.slice(-4);
mask.onclick = e => { if (e.target === mask) mask.classList.remove('on'); };
setCarry.onclick = () => setCarry.classList.toggle('on');

btnSave.onclick = () => {
  S.budget = Math.max(0, Math.round(Number(setBudget.value) || 0));
  S.mode = setMode.value;
  S.carry = setCarry.classList.contains('on');
  S.who = setWho.value.trim().slice(0, 12);
  save(); mask.classList.remove('on'); render(); pushSettings();
};

btnShare.onclick = async () => {
  btnShare.disabled = true; btnShare.textContent = '準備中…';
  const ok = await createHousehold();
  btnShare.disabled = false; btnShare.textContent = '夫婦で共有をはじめる';
  if (ok) { openSheet(); toast('共有をはじめました'); }
};
btnJoin.onclick = async () => {
  const code = joinCode.value.trim();
  if (!code) { toast('共有コードを入力してください'); return; }
  const keep = live().length === 0 ? false
    : confirm('この端末の記録を共有先にも追加しますか？\n\nOK＝追加する / キャンセル＝共有先の内容だけにする');
  btnJoin.disabled = true;
  const ok = await joinHousehold(code, keep);
  btnJoin.disabled = false;
  if (ok) { joinCode.value = ''; openSheet(); toast('共有に参加しました'); }
};
btnShowCode.onclick = () => {
  const shown = codeText.dataset.shown === '1';
  codeText.textContent = shown ? maskCode(S.hh.code) : S.hh.code;
  codeText.dataset.shown = shown ? '' : '1';
  btnShowCode.textContent = shown ? '表示' : '隠す';
};
btnCopy.onclick = async () => {
  const url = location.origin + location.pathname + '#join=' + S.hh.code;
  try { await navigator.clipboard.writeText(url); toast('参加用リンクをコピーしました'); }
  catch (e) { codeText.textContent = url; codeText.dataset.shown = '1'; toast('長押しでコピーしてください'); }
};
btnLeave.onclick = () => {
  if (!confirm('共有を解除します。\nこの端末には今のデータが残り、以後は相手と同期されません。')) return;
  leaveHousehold(); openSheet(); toast('共有を解除しました');
};

btnExport.onclick = () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'foodbudget_' + ymd(new Date()) + '.json'; a.click();
};
btnImport.onclick = () => fileImport.click();
fileImport.onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!Array.isArray(d.items)) throw 0;
      S = Object.assign({}, DEF, d); save(); mask.classList.remove('on');
      if (S.hh) connect();
      render();
    } catch (err) { toast('読み込めませんでした'); }
  };
  rd.readAsText(f);
};
btnClear.onclick = () => {
  if (!confirm('この端末の記録と設定を消します。よろしいですか？\n（共有中の場合、相手側のデータは残ります）')) return;
  localStorage.removeItem(KEY); S = Object.assign({}, DEF, { items: [] });
  ch = null; sb = null; mask.classList.remove('on'); render();
};

/* ---------- 起動 ---------- */
(function boot() {
  const m = location.hash.match(/join=([0-9a-f]{16,64})/i);
  render();
  if (S.hh) { connect(); pull(); }
  if (m) {
    history.replaceState(null, '', location.pathname);
    const code = m[1];
    if (!S.hh || S.hh.code !== code) {
      const keep = live().length > 0 && confirm('共有に参加します。\nこの端末の記録も共有先に追加しますか？');
      joinHousehold(code, keep).then(ok => ok && toast('共有に参加しました'));
    }
  }
})();

window.addEventListener('online', () => { paintStatus(); push().then(pull); });
window.addEventListener('offline', paintStatus);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { push(); pull(); } });
setInterval(() => { if (!document.hidden) { push(); pull(); } }, 60000);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
