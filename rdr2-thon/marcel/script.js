const safeStorage = {
  get(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }
};

const body = document.body;
const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('#site-nav');
const motionButton = document.querySelector('.motion-toggle');
const header = document.querySelector('.site-header');
const toast = document.querySelector('#demo-toast');
let toastTimer;

document.querySelector('[data-year]').textContent = new Date().getFullYear();

menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!open));
  menuButton.textContent = open ? 'Menu' : 'Luk';
  nav.classList.toggle('open', !open);
});

nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.textContent = 'Menu';
  nav.classList.remove('open');
}));

const calm = safeStorage.get('marcelo-calm') === 'true';
body.classList.toggle('calm', calm);
motionButton.setAttribute('aria-pressed', String(calm));
motionButton.textContent = calm ? 'Vis bevægelse' : 'Rolig visning';
motionButton.addEventListener('click', () => {
  const next = !body.classList.contains('calm');
  body.classList.toggle('calm', next);
  motionButton.setAttribute('aria-pressed', String(next));
  motionButton.textContent = next ? 'Vis bevægelse' : 'Rolig visning';
  safeStorage.set('marcelo-calm', String(next));
});

let scrollQueued = false;
function updateScroll() {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const progress = max > 0 ? scrollY / max : 0;
    document.documentElement.style.setProperty('--progress', String(progress));
    header.classList.toggle('is-stuck', scrollY > 120);
    scrollQueued = false;
  });
}
addEventListener('scroll', updateScroll, { passive:true });
updateScroll();

const revealNodes = document.querySelectorAll(
  '.intro>*, .live-copy, .live-screen, .about-heading, .about-grid>*, .values article, .section-head>*, .featured-project, .project-card, .clip, .numbers-intro, .number-grid article, .audience-panel>*, .collab-top>*, .collab-grid article, .collabs blockquote, .media-kit>*, .contact>*'
);
revealNodes.forEach(node => node.classList.add('reveal'));
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    });
  }, { threshold:.13, rootMargin:'0px 0px -35px' });
  revealNodes.forEach(node => observer.observe(node));
} else {
  revealNodes.forEach(node => node.classList.add('visible'));
}

function showDemoMessage(message = 'Dummy-link — indsæt den rigtige URL i index.html.') {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 220);
  }, 3200);
}

document.querySelectorAll('[data-demo-link]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  showDemoMessage();
}));
document.querySelector('[data-demo-download]').addEventListener('click', event => {
  event.preventDefault();
  showDemoMessage('Media kit er en dummy — læg PDF’en i mappen og opdatér linket.');
});

const form = document.querySelector('#contact-form');
const status = document.querySelector('#form-status');
const requiredFields = [...form.querySelectorAll('[required]')];
function validateField(field) {
  const valid = field.checkValidity();
  field.classList.toggle('field-error', !valid);
  field.setAttribute('aria-invalid', String(!valid));
  return valid;
}
requiredFields.forEach(field => field.addEventListener('blur', () => validateField(field)));
form.addEventListener('submit', event => {
  event.preventDefault();
  const valid = requiredFields.every(validateField);
  if (!valid) {
    status.textContent = 'Udfyld de markerede felter, før beskeden kan sendes.';
    requiredFields.find(field => !field.checkValidity())?.focus();
    return;
  }
  status.textContent = 'Demoformular: tilslut en formularservice eller backend før lancering.';
  showDemoMessage('Formularen virker visuelt — den mangler kun jeres rigtige endpoint.');
});

const precisePointer = matchMedia('(pointer:fine)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (precisePointer && !reducedMotion) {
  const card = document.querySelector('.portrait-card');
  card.addEventListener('pointermove', event => {
    if (body.classList.contains('calm')) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = (event.clientY - rect.top) / rect.height - .5;
    card.style.transform = `perspective(900px) rotateX(${y * -5}deg) rotateY(${x * 7}deg)`;
  });
  card.addEventListener('pointerleave', () => { card.style.transform = ''; });
}
