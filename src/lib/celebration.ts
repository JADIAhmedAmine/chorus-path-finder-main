import confetti from 'canvas-confetti';

const SUCCESS_COLORS = ['#22c55e', '#10b981', '#0ea5e9', '#3b82f6', '#a855f7'];

export function celebrateSuccess(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const duration = 1200;
  const end = Date.now() + duration;

  const fire = () => {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      startVelocity: 45,
      origin: { x: 0, y: 0.7 },
      colors: SUCCESS_COLORS,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      startVelocity: 45,
      origin: { x: 1, y: 0.7 },
      colors: SUCCESS_COLORS,
      disableForReducedMotion: true,
    });

    if (Date.now() < end) {
      requestAnimationFrame(fire);
    }
  };

  fire();
}
