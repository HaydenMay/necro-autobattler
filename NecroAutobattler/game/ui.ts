// DOM user interface: top bar, enemy preview, hand of cards, buttons, draft overlay, toasts and the debug panel.
import { BALANCE, ROLE_TEXT, SOUL_NAME } from '../core/balance.ts';
import { SOULS } from '../core/data.ts';
import type { SoulId } from '../core/data.ts';
import { isEndless } from '../core/waves.ts';
import { canMergeDeployed, canMergeFromHand, canSummon, cost, dominionFree, dominionUsed, stageWaves } from '../core/rules.ts';
import { enemyWave, previewText } from '../core/waves.ts';
import { audio } from './audio.ts';
import { artBg, hasArt, rarityColor, soulArt } from '../ui/portraits.ts';
import { SOUL_ICON, heartsHtml, fmt, iconImg, iconUrl, skullImgs } from '../ui/icons.ts';
import { describeUnlock } from '../core/progress.ts';

const portraitHtml = (s: SoulId): string => `<div class="pt" style="background:${artBg(s)}"><img src="${soulArt(s)}" alt="" draggable="false"></div>`;
const ICON = Object.fromEntries(SOULS.map((s) => [s, iconImg(SOUL_ICON[s], 'ic')])) as Record<SoulId, string>;
const $ = (id: string) => document.getElementById(id)!;
const stars = (n: number) => '★'.repeat(n);

export class Ui {
  private toastT = 0; private dbg: HTMLElement; private odds = '';
  constructor(private g: any) {
    $('btnHome').onclick = () => window.dispatchEvent(new Event('necro-go-home'));
    $('btnBattle').onclick = () => g.startBattle(); $('btnSwap').onclick = () => g.toggleSwap();
    $('btnRemove').onclick = () => g.removeSelected();
    $('btnSpeed').onclick = () => g.setSpeed(g.timeScale > 1 ? 1 : 2);
    document.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) => (b.onclick = () => g.setCamMode(b.dataset.cam!)));
    $('gear').onclick = () => { this.dbg.classList.toggle('open'); this.renderDebug(); };
    const snd = () => { $('btnMusic').classList.toggle('off', !audio.music); $('btnSfx').classList.toggle('off', !audio.sfx); const si = $('btnSfx').querySelector('img'); if (si) si.src = iconUrl(audio.sfx ? 'sound_on' : 'sound_off'); };
    $('btnMusic').onclick = () => { audio.setMusic(!audio.music); snd(); }; $('btnSfx').onclick = () => { audio.setSfx(!audio.sfx); snd(); };
    window.addEventListener('necro-settings', snd); snd();
    this.dbg = $('debug'); if (new URLSearchParams(location.search).get('debug')) this.dbg.classList.add('open');
    this.renderDebug();
  }

  /** The Necromancer just lost a heart: make the hearts bump. */
  pulseHearts() { const h = $('hearts'); h.classList.remove('hurt'); void h.offsetWidth; h.classList.add('hurt'); }
  toast(msg: string) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(this.toastT); this.toastT = window.setTimeout(() => t.classList.remove('show'), 3600); }

  render() {
    const g = this.g, s = g.s, ph = g.phase, build = ph === 'build';
    $('hearts').innerHTML = heartsHtml(s.hearts);
    $('wave').textContent = isEndless() ? `Wave ${s.wave}` : `Wave ${s.wave}/${stageWaves(s)}`;
    const used = dominionUsed(s); $('dom').textContent = `${used}/${s.cap}`; ($('domfill') as HTMLElement).style.width = Math.min(100, (used / s.cap) * 100) + '%';
    // enemy preview: what is coming, never where
    const pv = previewText(enemyWave(s.wave, g.seed));
    $('enemy').innerHTML = `<b>Next enemies</b>` + pv.map((p) => `<div class="erow"><span>${ICON[p.soul as SoulId]}</span><span>${SOUL_NAME[p.soul as SoulId]}${(p as any).boss ? ' <b style="color:#ff7b6a">BOSS</b>' : ''}</span><span class="x">×${p.count}</span><span class="st">${stars(p.star)}</span></div>`).join('') + `<div class="hint">Positions stay hidden until the battle.</div>`;
    // hand
    const hand = $('hand'); hand.innerHTML = '';
    s.hand.forEach((soul: SoulId, i: number) => {
      const el = document.createElement('div'); const sel = g.sel && g.sel.type === 'card' && g.sel.idx === i; const afford = canSummon(s, i), canMerge = s.units.some((u: any) => canMergeFromHand(s, i, u.id)), usable = afford || canMerge;
      const art = hasArt(soul); el.className = 'card' + (art ? ' art' : '') + (sel ? ' sel' : '') + (!usable && !g.swapMode ? ' dis' : '') + (g.swapMode ? ' swap' : '');
      const tag = afford ? `<span class="ok">Summon</span>` : canMerge ? '<span class="ok mg">Merge only</span>' : '<span class="no">No room</span>';
      if (art) el.style.borderColor = rarityColor(soul);
      el.innerHTML = `<div class="cost">${cost(soul, 1)}</div>${art ? portraitHtml(soul) : ICON[soul] + `<div class="nm">${SOUL_NAME[soul]}</div>`}<div class="cs">${tag}</div>`; el.title = ROLE_TEXT[soul] + (afford ? '' : canMerge ? ' - Dominion is full, but you can merge it into your matching 1-star unit.' : ' - Not enough free Dominion to summon this.');
      el.onclick = () => g.onCard(i); hand.appendChild(el);
    });
    if (!s.hand.length) hand.innerHTML = '<div class="empty">No cards in hand</div>';
    // buttons
    ($('btnBattle') as HTMLButtonElement).disabled = !build || !s.units.length;
    const sw = $('btnSwap') as HTMLButtonElement; sw.disabled = !build || s.discardUsed; sw.classList.toggle('on', g.swapMode); sw.textContent = s.discardUsed ? 'Swap used' : g.swapMode ? 'Swap: pick a card or unit' : 'Swap (1/round)';
    const selU = g.sel && g.sel.type === 'unit' ? s.units.find((u: any) => u.id === g.sel.id) : null;
    const partner = selU && s.units.some((o: any) => canMergeDeployed(selU, o));
    $('unitpanel').style.display = build && selU ? 'flex' : 'none';
    $('btnRemove').textContent = g.confirmRemove ? 'Confirm remove' : 'Remove';
    $('info').textContent = build ? (g.swapMode ? 'SWAP: tap a hand card to discard it, or tap a unit you did not summon this round to sell it. You draw a different Soul.'
      : selU ? `${SOUL_NAME[selU.soul as SoulId]} ${stars(selU.star)}  •  ${ROLE_TEXT[selU.soul as SoulId]}  ${partner ? '• Tap the matching unit to merge into a stronger star.' : ''}`
      : g.sel && g.sel.type === 'card' ? `${SOUL_NAME[s.hand[g.sel.idx] as SoulId]}: ${ROLE_TEXT[s.hand[g.sel.idx] as SoulId]}  •  ` + (() => { const i = g.sel.idx, sm = canSummon(s, i), mg = s.units.some((u: any) => canMergeFromHand(s, i, u.id)); return sm && mg ? 'Tap a green tile to summon, or a glowing purple unit to merge it in.' : sm ? 'Tap a green tile to summon.' : mg ? 'Dominion is full: tap a glowing purple unit to merge it in.' : 'Not enough free Dominion to summon this.'; })() : 'Tap a card, then a tile. Tap a unit to merge, move or remove it.')
      : ph === 'battle' || ph === 'transition' ? 'Battle! Units fight on their own.' : '';
    $('speed').style.display = ph === 'battle' || ph === 'transition' ? 'flex' : 'none';
    const fast = g.speedUnlocked(); if (!fast && g.timeScale > 1) g.timeScale = 1;
    const sb = $('btnSpeed'); sb.style.display = fast ? '' : 'none'; sb.textContent = g.timeScale + 'x'; sb.classList.toggle('on', g.timeScale > 1);
    document.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === g.camMode));
    document.body.classList.toggle('inbattle', ph === 'battle' || ph === 'transition'); audio.setMode(ph === 'battle' || ph === 'transition' ? 'battle' : 'build');
    // overlay
    const ov = $('overlay'); ov.className = ''; ov.innerHTML = '';
    if (ph === 'draft' && g.draft) {
      ov.className = 'show'; ov.innerHTML = `<div class="box"><h2>Victory Draft</h2><div class="sub">Wave cleared. Dominion is now ${s.cap}.${g.lastGold ? ` <b style="color:#ffd24a">+${fmt(g.lastGold)}</b> ${iconImg('gold')}` : ''} Keep one:</div><div class="row">${g.draft.map((soul: SoulId, i: number) => `<div class="card big${hasArt(soul) ? ' art' : ''}" data-i="${i}"${hasArt(soul) ? ` style="border-color:${rarityColor(soul)}"` : ''}><div class="cost">${cost(soul, 1)}</div>${hasArt(soul) ? portraitHtml(soul) : ICON[soul]}<div class="nm">${SOUL_NAME[soul]}</div><div class="role">${ROLE_TEXT[soul]}</div></div>`).join('')}</div></div>`;
      ov.querySelectorAll<HTMLElement>('.card').forEach((c) => (c.onclick = () => g.pickDraft(+c.dataset.i!)));
    } else if (ph === 'won' || ph === 'lost') {
      const rw = ph === 'won' ? g.reward : null, sk = (n: number) => skullImgs(n);
      const unlockHtml = rw && rw.unlocked && rw.unlocked.length ? `<div class="sub" style="color:#7ef2c8;font-weight:700">${iconImg('check')} Unlocked: ${rw.unlocked.map((k: string) => describeUnlock(k)).join(' \u00b7 ')}</div>` : '';
      const goldHtml = g.runGold ? `<div class="sub" style="color:#ffd24a;font-weight:700">${iconImg('gold')} Gold earned this run: ${fmt(g.runGold)}</div>` : '';
      const dr = ph === 'won' && g.daily ? g.dailyReward : null;
      const dailyHtml = g.daily ? (dr ? `<div class="sub" style="color:#ffd24a;font-weight:700">${dr.pack ? `${iconImg('shop')} Daily complete! Day ${dr.streak} in a row: a ${sk(dr.pack.tier)} Soul Pack and ${fmt(dr.gold)} ${iconImg('gold')}.` : 'Daily complete again. The reward comes once per day: see you tomorrow!'}</div>` : '') : '';
      const rewardHtml = goldHtml + dailyHtml + unlockHtml + (rw ? `<div class="sub" style="color:#ffd24a;font-weight:700">${rw.pack ? (rw.first ? `${iconImg('shop')} First clear! You earned a ${sk(rw.pack.tier)} Soul Pack.` : `${iconImg('shop')} Replay reward: a ${sk(rw.pack.tier)} Soul Pack.`) : `Replay progress ${rw.replayMeter}/${rw.replayNeeded} toward a Soul Pack.`}</div>` : '');
      if (ph === 'lost' && isEndless() && g.endless) {                    // the end of an endless run: how deep, any record, packs earned
        const e = g.endless, rec = e.cleared > e.startBest;
        ov.className = 'show'; ov.innerHTML = `<div class="box"><h2>Run over</h2><div class="sub">You cleared ${e.cleared} wave${e.cleared === 1 ? '' : 's'}. ${rec ? '<b style="color:#ffd24a">New best depth!</b>' : 'Best: wave ' + Math.max(e.startBest, e.cleared) + '.'}</div>${g.runGold ? `<div class="sub" style="color:#ffd24a;font-weight:700">${iconImg('gold')} Gold earned this run: ${fmt(g.runGold)}</div>` : ''}${e.packs ? `<div class="sub" style="color:#ffd24a;font-weight:700">${iconImg('shop')} ${e.packs} Soul Pack${e.packs === 1 ? '' : 's'} earned this run.</div>` : '<div class="sub">Clear wave 10 to earn a Soul Pack.</div>'}<div class="row">${e.packs ? '<button id="toShop" class="go">Open pack</button>' : ''}<button id="again" class="${e.packs ? 'blue' : 'go'}">Go again</button><button id="toHome" class="blue">Home</button></div></div>`;
        $('again').onclick = () => g.newEndless(); $('toHome').onclick = () => window.dispatchEvent(new Event('necro-go-home'));
        const ts2 = document.getElementById('toShop'); if (ts2) ts2.onclick = () => window.dispatchEvent(new Event('necro-go-shop'));
      } else {
      ov.className = 'show'; ov.innerHTML = `<div class="box"><h2>${g.daily ? (ph === 'won' ? 'Daily complete!' : 'Challenge failed') : ph === 'won' ? 'Stage cleared!' : 'Stage lost'}</h2><div class="sub">${g.lastBattle}</div>${rewardHtml}<div class="row">${(rw && rw.pack) || (dr && dr.pack) ? '<button id="toShop" class="go">Open pack</button>' : ''}<button id="again" class="${(rw && rw.pack) || (dr && dr.pack) ? 'blue' : 'go'}">${ph === 'won' ? 'Play again' : 'Try again'}</button><button id="toHome" class="blue">Home</button></div></div>`;
      $('again').onclick = () => (g.daily ? g.newDaily() : g.newRun()); $('toHome').onclick = () => window.dispatchEvent(new Event('necro-go-home'));
      const ts = document.getElementById('toShop'); if (ts) ts.onclick = () => window.dispatchEvent(new Event('necro-go-shop'));
      }
    }
    this.renderDebugLive();
    if (ph === 'build') requestAnimationFrame(() => g.reframeBuild());     // after layout: keep the grid clear of the hand and buttons
  }

  // ------------------------------------------------------------------------------------------ debug panel
  private renderDebug() {
    const g = this.g, d = this.dbg; if (!d.classList.contains('open')) { d.innerHTML = ''; return; }
    const row = (label: string, obj: any, key: string | number, min: number, max: number, step: number) => `<label>${label} <input type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}" data-o="${label}"><span>${obj[key]}</span></label>`;
    d.innerHTML = `<b>Debug (live)</b> <span id="dbgfps"></span>
      <div class="dsec">Star multipliers (bodies = damage, stars = durability)
        ${row('HP x 2★', BALANCE.star.hp, 1, 1, 4, 0.05)}${row('HP x 3★', BALANCE.star.hp, 2, 1, 6, 0.05)}${row('Damage x 2★', BALANCE.star.dmg, 1, 1, 4, 0.05)}${row('Damage x 3★', BALANCE.star.dmg, 2, 1, 6, 0.05)}${row('Size 2★', BALANCE.star.scale, 1, 1, 1.6, 0.02)}${row('Size 3★', BALANCE.star.scale, 2, 1, 2, 0.02)}</div>
      <div class="dsec"><table><tr><th></th><th>hp</th><th>dmg</th><th>rate</th><th>range</th><th>spd</th></tr>${SOULS.map((k) => `<tr><td>${ICON[k]}</td>${['hp', 'dmg', 'interval', 'range', 'speed'].map((f) => `<td><input class="num" data-soul="${k}" data-f="${f}" value="${(BALANCE.stats as any)[k][f]}"></td>`).join('')}</tr>`).join('')}</table></div>
      <div class="dsec">Difficulty <select id="dDiff">${['easy', 'normal', 'hard', 'nightmare'].map((k) => `<option value="${k}" ${g.difficulty === k ? 'selected' : ''}>${k}</option>`).join('')}</select> <small>(applies to the next battle)</small></div>
      <div class="dsec"><label><input type="checkbox" id="dMergeHand" ${g.s.rules.merge === 'handIntoOneStar' ? 'checked' : ''}> Merge a hand card straight into a deployed unit (off = doc rule: both copies must be on the board)</label></div>
      <div class="dsec">Performance<br><small id="dbgPerf">measuring…</small><br><label><input type="checkbox" id="dFps" ${g.showFps ? 'checked' : ''}> Show FPS on the battle screen</label> <button id="dPerf">Copy perf report</button></div>
      <div class="dsec"><button id="dOdds">Test odds (200 fights)</button> <span id="dOddsOut">${this.odds}</span></div>
      <div class="dsec"><button id="dCopy">Copy report</button> <button id="dReset">Reset balance</button> <button id="dRestart">Restart stage</button></div>
      <div class="dsec">Add card <select id="dCard">${SOULS.map((k) => `<option value="${k}">${SOUL_NAME[k]}</option>`).join('')}</select> <button id="dAdd">+</button> <button id="dDom">+2 Dominion</button></div>
      <div class="dsec"><small>Last tap: <span id="dbgtap">${g.lastTapInfo}</span></small></div>
      <div class="dsec"><small>Seed ${g.seed}. Add <code>?seed=7</code> to the link to replay the same draws.</small></div>`;
    d.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => (inp.oninput = () => {
      const lab = inp.dataset.o!; const v = +inp.value; (inp.nextElementSibling as HTMLElement).textContent = String(v);
      const set: Record<string, () => void> = { 'HP x 2★': () => (BALANCE.star.hp[1] = v), 'HP x 3★': () => (BALANCE.star.hp[2] = v), 'Damage x 2★': () => (BALANCE.star.dmg[1] = v), 'Damage x 3★': () => (BALANCE.star.dmg[2] = v), 'Size 2★': () => (BALANCE.star.scale[1] = v), 'Size 3★': () => (BALANCE.star.scale[2] = v) };
      set[lab](); g.applyBalanceChange();
    }));
    d.querySelectorAll<HTMLInputElement>('input.num').forEach((inp) => (inp.onchange = () => { (BALANCE.stats as any)[inp.dataset.soul!][inp.dataset.f!] = +inp.value; }));
    $('dDiff').onchange = (e) => g.changeDifficulty((e.target as HTMLSelectElement).value);
    $('dMergeHand').onchange = (e) => { g.s.rules.merge = (e.target as HTMLInputElement).checked ? 'handIntoOneStar' : 'deployedOnly'; g.syncBuild(); this.render(); };
    $('dOdds').onclick = () => { const r = g.testOdds(200); this.odds = `${r.win}% win (${r.n} fights, avg ${r.avgTime}s) vs wave ${g.s.wave}`; $('dOddsOut').textContent = this.odds; };
    $('dCopy').onclick = () => { const t = g.report(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => this.toast('Report copied. Paste it into chat.')).catch(() => { prompt('Copy this report:', t); }); };
    $('dFps').onchange = (e) => g.setShowFps((e.target as HTMLInputElement).checked);
    $('dPerf').onclick = () => { const t = g.perfReport(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => this.toast('Perf report copied. Paste it into chat.')).catch(() => { prompt('Copy this report:', t); }); };
    $('dReset').onclick = () => { g.resetBalanceAll(); this.renderDebug(); };
    $('dRestart').onclick = () => g.startStage(g.seed);
    $('dAdd').onclick = () => g.addCard(($('dCard') as HTMLSelectElement).value as SoulId); $('dDom').onclick = () => g.addDominion(2);
  }
  renderDebugLive() {
    const f = document.getElementById('dbgfps'); if (f) f.textContent = `${this.g.phase}`;
    const pf = document.getElementById('dbgPerf'); if (pf) { const p = this.g.perfInfo(); pf.textContent = `${p.fps.toFixed(0)} fps · avg ${p.avg.toFixed(1)}ms · slow5% ${p.p95.toFixed(0)}ms · worst ${p.worst.toFixed(0)}ms · ${p.meshes} meshes · ${p.particles} particle systems · ${p.draws} draw calls`; }
    const t = document.getElementById('dbgtap'); if (t) t.textContent = this.g.lastTapInfo;
  }
}
