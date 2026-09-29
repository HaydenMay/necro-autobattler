import { setDifficulty, AUTHORED, waveCost } from '../core/waves.ts';
import { playStage } from './campaign.ts';
for (const name of ['easy','normal','hard','nightmare']) {
  setDifficulty(name); const RUNS=400; let out: string[]=[];
  for (const pol of ['smart','lazy']) { let clear=0, hearts=0; for (let i=0;i<RUNS;i++){ const r=playStage(pol, 3000+i); if(r.state.status==='won') clear++; hearts+=r.state.hearts; } out.push(`${pol}: clear ${Math.round(clear/RUNS*100)}% avg hearts left ${(hearts/RUNS).toFixed(2)}`); }
  console.log(name.padEnd(7)+' wave costs '+AUTHORED.map(waveCost).join('/')+'  |  '+out.join('  |  '));
}
