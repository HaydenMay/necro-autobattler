import { Game } from './game.ts';

const g = new Game();
(window as any).__game = g;                       // handy for debugging from the browser console
g.init(document.getElementById('c') as HTMLCanvasElement)
  .then(() => { const l = document.getElementById('loading'); if (l) l.style.display = 'none'; (window as any).__gameReady = true; window.dispatchEvent(new Event('necro-game-ready')); })
  .catch((e) => {
    const l = document.getElementById('loading'); if (l) { l.style.display = 'flex'; l.textContent = 'Error: ' + (e && e.message ? e.message : e); }
    console.error(e);
  });
