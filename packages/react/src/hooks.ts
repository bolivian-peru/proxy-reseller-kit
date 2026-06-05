'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeResponse, PoolStock, CarrierStock, Incident } from './types';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface HookResult<T> extends FetchState<T> {
  /** Re-run the fetch. Returns the new data (or throws). */
  refetch: () => Promise<T>;
}

/** Shared fetcher that respects abort signals and normalizes errors. */
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, credentials: 'same-origin' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${url} → ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
  }
  return (await res.json()) as T;
}

/**
 * Fetches the authenticated user's pool access key + usage snapshot from the
 * host app's API route.
 *
 * @param apiRoute Base path mounted on the host, typically `/api/pool`.
 *                 Hook calls `${apiRoute}/me`.
 * @param options  Optional refresh interval in ms. Default: none (fetch once).
 */
export function usePoolKey(
  apiRoute: string,
  options: { refreshIntervalMs?: number } = {},
): HookResult<MeResponse> {
  return usePolling<MeResponse>(`${apiRoute}/me`, options.refreshIntervalMs);
}

/**
 * Fetches live pool stock from the host's API route (which proxies to
 * `/v1/gateway/pool/stock`).
 *
 * @param apiRoute Base path, e.g. `/api/pool`.
 * @param options  Refresh interval — useful for the pool indicator pulse.
 *                 Default 30 000 ms (matches server-side cache TTL).
 */
export function usePoolStock(
  apiRoute: string,
  options: { refreshIntervalMs?: number } = {},
): HookResult<PoolStock> {
  return usePolling<PoolStock>(`${apiRoute}/stock`, options.refreshIntervalMs ?? 30_000);
}

/**
 * Fetches live routable PEER stock by carrier/ASN for a country (counts only).
 * Re-fetches when `country` changes. Proxies to
 * `/v1/gateway/pool/stock/carriers`. Drives a carrier/ASN selector — pair an
 * entry's `asn` with `buildProxyString({ asn })`.
 *
 * @param apiRoute Base path, e.g. `/api/pool`.
 * @param country  ISO 2-letter code, e.g. `'us'`.
 */
export function usePoolCarrierStock(
  apiRoute: string,
  country: string,
  options: { refreshIntervalMs?: number } = {},
): HookResult<CarrierStock> {
  return usePolling<CarrierStock>(
    `${apiRoute}/stock/carriers?country=${encodeURIComponent(country)}`,
    options.refreshIntervalMs ?? 30_000,
  );
}

/** Fetches active gateway incidents. Poll every 60s by default. */
export function useIncidents(
  apiRoute: string,
  options: { refreshIntervalMs?: number } = {},
): HookResult<Incident[]> {
  return usePolling<Incident[]>(`${apiRoute}/incidents`, options.refreshIntervalMs ?? 60_000);
}

/**
 * Low-level polling hook used by the others. Extracted so host apps can build
 * their own endpoints without reimplementing the abort/cleanup logic.
 */
function usePolling<T>(url: string, refreshIntervalMs?: number): HookResult<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  // Keep the latest url in a ref so the interval callback always targets the current URL
  // even if the caller passes a dynamic value (rare, but safe).
  const urlRef = useRef(url);
  urlRef.current = url;

  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async (): Promise<T> => {
    controllerRef.current?.abort();
    const ctrl = new AbortController();
    controllerRef.current = ctrl;

    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await getJson<T>(urlRef.current, ctrl.signal);
      setState({ data, loading: false, error: null });
      return data;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw err;
      }
      setState((s) => ({ ...s, loading: false, error: err as Error }));
      throw err;
    }
  }, []);

  useEffect(() => {
    run().catch(() => {
      /* already captured in state */
    });
    if (refreshIntervalMs && refreshIntervalMs > 0) {
      const id = setInterval(() => {
        run().catch(() => {
          /* silent; state already reflects error */
        });
      }, refreshIntervalMs);
      return () => {
        clearInterval(id);
        controllerRef.current?.abort();
      };
    }
    return () => {
      controllerRef.current?.abort();
    };
  }, [run, refreshIntervalMs]);

  return { ...state, refetch: run };
}

/** Copy text to clipboard, falling back to a textarea hack for older browsers. */
export function useCopyToClipboard(): {
  copy: (text: string) => Promise<boolean>;
  copied: boolean;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { copy, copied };
}
