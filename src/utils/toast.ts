export type ToastKind = 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  duration?: number;
}

const DEFAULT_DURATION_MS = 2000;

export function showToast(message: string, options?: ToastOptions): void {
  if (typeof document === 'undefined') return;

  const kind = options?.kind ?? 'success';
  const duration = options?.duration ?? DEFAULT_DURATION_MS;

  const el = document.createElement('div');
  el.className = `notez-toast notez-toast--${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.classList.add('notez-toast--visible');
  });

  const hide = () => {
    el.classList.remove('notez-toast--visible');
    window.setTimeout(() => el.remove(), 300);
  };

  window.setTimeout(hide, duration);
}
