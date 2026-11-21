// Pop-up-uri in stilul jocului: inlocuiesc window.confirm / window.alert (nu mai apare niciodata dialogul browserului).
// Tastele sunt interceptate (doar keydown) cat timp e deschis un pop-up, ca sa nu ajunga in joc (E, Q, WASD...).
type Tone = 'info' | 'good' | 'bad';
type Opts = { title: string; text: string; ok?: string; cancel?: string; danger?: boolean; tone?: Tone };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function open(o: Opts, withCancel: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const tone: Tone = o.tone ?? (o.danger ? 'bad' : 'info');
    const ov = document.createElement('div');
    ov.className = 'mdl-ov';
    ov.innerHTML = `<div class="mdl mdl-${tone}" role="alertdialog" aria-modal="true" aria-labelledby="mdl-t">
      <div class="mdl-tape"></div>
      <h3 id="mdl-t">${esc(o.title)}</h3>
      <p>${esc(o.text)}</p>
      <div class="mdl-btns">
        ${withCancel ? `<button class="btn ghost" data-r="0">${esc(o.cancel ?? 'Anuleaza')}</button>` : ''}
        <button class="btn ${o.danger ? 'danger' : 'primary'}" data-r="1">${esc(o.ok ?? 'OK')}</button>
      </div></div>`;
    const btns = Array.from(ov.querySelectorAll<HTMLButtonElement>('button'));

    const done = (r: boolean) => {
      window.removeEventListener('keydown', onKey, true);
      ov.classList.add('out');
      setTimeout(() => ov.remove(), 120);
      resolve(r);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();   // doar keydown: keyup trebuie sa ajunga la Phaser, altfel o tasta ramane "apasata"
      if (e.key === 'Escape') { e.preventDefault(); done(!withCancel); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const f = btns.find((b) => b === document.activeElement);
        done(f ? f.dataset.r === '1' : !o.danger);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus();
      }
    };
    ov.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-r]');
      if (b) done(b.dataset.r === '1');
    });
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    (o.danger && withCancel ? btns[0] : btns[btns.length - 1]).focus();   // la actiuni periculoase Enter = Anuleaza
  });
}

export const confirmBox = (o: Opts) => open(o, true);
export const infoBox = (o: Opts) => open(o, false).then(() => undefined);