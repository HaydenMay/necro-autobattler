// Clear rates of the smart stand-in on Stage 2 and 3 at each tier's recommended level and two levels below it.   node sim/stage_check.ts
import { STAGES, setStageDifficulty, DIFFS } from '../core/waves.ts';
import { playStage } from './campaign.ts';
for (const st of STAGES.slice(1)) for (const d of DIFFS) { setStageDifficulty(st.id, d); const lv = st.rec[d]; let w = 0, w2 = 0; const N = 150; for (let i = 0; i < N; i++) { if (playStage('smart', 20000 + i, lv, st.power[d]).state.status === 'won') w++; if (playStage('smart', 20000 + i, Math.max(1, lv - 2), st.power[d]).state.status === 'won') w2++; } console.log(`${st.id}/${d} power ${st.power[d]} level ${lv}: ${Math.round(100 * w / N)}%  (two lower: ${Math.round(100 * w2 / N)}%)`); }
