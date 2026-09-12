/** Keep a warm screen during pagination, but never borrow another workspace's data. */
export function keepScopedData(scope: Readonly<Record<number, unknown>>) {
  return <T>(
    previousData: T | undefined,
    previousQuery: { queryKey: readonly unknown[] } | undefined
  ): T | undefined => {
    if (!previousQuery) return undefined;
    return Object.entries(scope).every(([index, value]) => previousQuery.queryKey[Number(index)] === value)
      ? previousData
      : undefined;
  };
}
