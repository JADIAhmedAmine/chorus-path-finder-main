import { useEffect, useState } from 'react';

export interface AsyncResourceState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useAsyncResource<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  initialValue: T,
): AsyncResourceState<T> {
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const nextData = await loader();
        if (!cancelled) {
          setData(nextData);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Chargement impossible.');
          setData(initialValue);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [...deps, reloadToken]);

  return {
    data,
    loading,
    error,
    reload: async () => {
      setReloadToken((value) => value + 1);
    },
  };
}
