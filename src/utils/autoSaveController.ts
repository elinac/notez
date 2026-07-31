let timer: ReturnType<typeof setTimeout> | null = null;
let writeGeneration = 0;

export function cancelPendingAutoSave(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  writeGeneration += 1;
}

export function scheduleAutoSave(
  fn: () => void | Promise<void>,
  delayMs = 1000,
): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void fn();
  }, delayMs);
}

export function beginAutoSaveWrite(): number {
  return writeGeneration;
}

export function isAutoSaveWriteCurrent(gen: number): boolean {
  return gen === writeGeneration;
}

export function clearAutoSaveTimerOnly(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
