/** 从持久化 settings 归一化枚举 ID（未知值回落 default） */
export function normalizeOptionId<T extends string>(
  raw: unknown,
  validIds: ReadonlySet<string>,
  fallback: T
): T {
  return typeof raw === 'string' && validIds.has(raw) ? (raw as T) : fallback;
}
