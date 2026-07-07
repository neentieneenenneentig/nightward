// DOM overlay UI — HTML/CSS handles text, buttons and responsiveness far
// better than in-canvas UI, and it composites for free above the game.
export function createHud(seed: number) {
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const hud = document.getElementById('hud')!;
  hud.innerHTML = `
    <div class="top">
      <span class="title">NIGHTWARD</span>
      <span class="seed">world #${seed}</span>
      <button id="btn-new">&#10227; NEW WORLD</button>
    </div>
    <div class="hint">${touch ? 'drag anywhere to roam' : 'WASD / arrows to roam'}</div>`;

  document.getElementById('btn-new')!.addEventListener('click', () => {
    location.hash = 's=' + ((Math.random() * 2 ** 31) | 0);
    location.reload();
  });
  setTimeout(() => hud.querySelector('.hint')?.classList.add('fade'), 6000);
}
