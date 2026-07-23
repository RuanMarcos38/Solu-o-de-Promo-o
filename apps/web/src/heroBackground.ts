const HERO_SELECTOR = '.hero';
const VIDEO_SOURCE = '/media/hero-background.mp4';
const POSTER_SOURCE = '/media/hero-poster.jpg';

function enhanceHero(hero: HTMLElement) {
  if (hero.dataset.heroVideoEnhanced === 'true') return;

  hero.dataset.heroVideoEnhanced = 'true';

  const background = document.createElement('div');
  background.className = 'hero-background';
  background.setAttribute('aria-hidden', 'true');

  const video = document.createElement('video');
  video.className = 'hero-background__video';
  video.src = VIDEO_SOURCE;
  video.poster = POSTER_SOURCE;
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.controls = false;
  video.tabIndex = -1;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('disablepictureinpicture', '');
  video.setAttribute('disableremoteplayback', '');
  video.setAttribute('controlslist', 'nodownload noremoteplayback nofullscreen');
  video.setAttribute('aria-hidden', 'true');

  video.addEventListener('canplay', () => {
    background.classList.add('is-ready');
    void video.play().catch(() => undefined);
  }, { once: true });

  video.addEventListener('error', () => {
    background.classList.add('has-error');
  }, { once: true });

  background.appendChild(video);
  hero.prepend(background);
}

function enhanceAvailableHeroes(root: ParentNode) {
  root.querySelectorAll<HTMLElement>(HERO_SELECTOR).forEach(enhanceHero);
}

export function installHeroBackground(root: HTMLElement) {
  enhanceAvailableHeroes(root);

  const observer = new MutationObserver(() => enhanceAvailableHeroes(root));
  observer.observe(root, { childList: true, subtree: true });

  requestAnimationFrame(() => enhanceAvailableHeroes(root));

  return () => observer.disconnect();
}
