import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import { PoolPortal } from '../src/PoolPortal';
import { usePoolCarrierStock, usePoolFacets } from '../src/hooks';
import { PoolSessionSpawner } from '../src/PoolSessionSpawner';
import { PrivatePoolPanel } from '../src/PrivatePoolPanel';
import type { MeResponse } from '../src/types';

const ME_FIXTURE: MeResponse = {
  proxyUsername: 'psx_abc123',
  pakKey: 'pak_000000000000000000000001',
  pakKeyId: '65fabc',
  usage: {
    usedMB: 512,
    usedGB: 0.5,
    capGB: 10,
    enabled: true,
    lastUsedAt: '2026-04-24T12:00:00Z',
  },
};

const STOCK_FIXTURE = {
  updatedAt: '2026-04-24T12:00:00Z',
  countries: [
    { country: 'us', mbl: { online: 32, total: 34 }, peer: { online: 12, total: 15 } },
    { country: 'gb', mbl: { online: 18, total: 20 }, peer: { online: 4, total: 8 } },
  ],
};

function mockFetchByPath(pathMap: Record<string, unknown>) {
  return vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [suffix, body] of Object.entries(pathMap)) {
      if (url.endsWith(suffix)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  });
}

describe('<PoolPortal>', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (globalThis as { fetch?: unknown }).fetch = mockFetchByPath({
      '/me': ME_FIXTURE,
      '/stock': STOCK_FIXTURE,
      '/incidents': [],
    });
  });

  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
  });

  it('renders the proxy URL after the fetch resolves', async () => {
    render(<PoolPortal apiRoute="/api/pool" />);

    await waitFor(() => {
      expect(screen.getByText(/psx_abc123.*mbl.*pak_/)).toBeInTheDocument();
    });
  });

  it('updates the URL when the user changes country + rotation', async () => {
    render(<PoolPortal apiRoute="/api/pool" defaultCountry="us" />);

    await waitFor(() => {
      expect(screen.getByLabelText(/country/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'gb' } });
    fireEvent.change(screen.getByLabelText(/rotation/i), { target: { value: 'sticky' } });

    await waitFor(() => {
      const url = screen.getByText(/psx_abc123-mbl-gb-rot-sticky/);
      expect(url).toBeInTheDocument();
    });
  });

  it('switches port based on protocol', async () => {
    render(<PoolPortal apiRoute="/api/pool" />);
    await waitFor(() => screen.getByLabelText(/protocol/i));

    fireEvent.change(screen.getByLabelText(/protocol/i), { target: { value: 'socks5' } });

    await waitFor(() => {
      expect(screen.getByText(/socks5:\/\/.*:7001/)).toBeInTheDocument();
    });
  });

  it('shows an error state when /me fails', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    );
    render(<PoolPortal apiRoute="/api/pool" />);
    await waitFor(() => {
      expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    });
  });

  it('shows usage bar summary with used / cap', async () => {
    const { container } = render(<PoolPortal apiRoute="/api/pool" />);
    // 0.5 GB renders as "512 MB"; 10 GB renders as "10.00 GB".
    // They're adjacent text nodes in the DOM so match on the element's textContent.
    await waitFor(() => {
      const summary = container.querySelector('.psx-usage-summary');
      expect(summary?.textContent).toMatch(/512 MB/);
      expect(summary?.textContent).toMatch(/10\.00 GB/);
    });
  });

  it('shows unlimited message when cap is null', async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetchByPath({
      '/me': { ...ME_FIXTURE, usage: { ...ME_FIXTURE.usage, capGB: null } },
      '/stock': STOCK_FIXTURE,
      '/incidents': [],
    });
    render(<PoolPortal apiRoute="/api/pool" />);
    await waitFor(() => {
      expect(screen.getByText(/unlimited/i)).toBeInTheDocument();
    });
  });

  it('surfaces incident banner when incidents are active', async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetchByPath({
      '/me': ME_FIXTURE,
      '/stock': STOCK_FIXTURE,
      '/incidents': [
        {
          id: 'inc1',
          severity: 'minor',
          title: 'Degraded DE pool',
          description: 'Some endpoints offline',
          startedAt: '2026-04-24T11:00:00Z',
          affects: ['de'],
        },
      ],
    });
    render(<PoolPortal apiRoute="/api/pool" />);
    await waitFor(() => {
      expect(screen.getByText(/degraded de pool/i)).toBeInTheDocument();
    });
  });

  it('renders custom brand name', async () => {
    render(
      <PoolPortal
        apiRoute="/api/pool"
        branding={{ name: 'AcmeProxies' }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('AcmeProxies')).toBeInTheDocument();
    });
  });
});


describe('carrier source hooks', () => {
  beforeEach(() => cleanup());
  const originalFetch = globalThis.fetch;
  afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

  it('refreshes when source changes and translates gateway any to combined stock', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), 'https://fixture.test');
      const total = url.searchParams.get('pool') === 'all' ? 37 : 2;
      return new Response(JSON.stringify({ country: 'us', total, other: 0, carriers: [] }));
    });
    globalThis.fetch = fetcher as typeof fetch;
    const { result, rerender } = renderHook(({ pool }: { pool?: 'peer' | 'any' }) => usePoolCarrierStock('/api/pool', 'us', { pool }), { initialProps: { pool: undefined } });
    await waitFor(() => expect(result.current.data?.total).toBe(2));
    expect(String(fetcher.mock.calls[0][0])).toBe('/api/pool/stock/carriers?country=us');
    rerender({ pool: 'any' });
    await waitFor(() => expect(result.current.data?.total).toBe(37));
    expect(String(fetcher.mock.calls.at(-1)![0])).toBe('/api/pool/stock/carriers?country=us&pool=all');
  });

  it('facets preserve encoded carrier identity with the combined source', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ country: 'us', carriers: [], total: 1 })));
    globalThis.fetch = fetcher as typeof fetch;
    const { result } = renderHook(() => usePoolFacets('/api/pool', { country: 'us', pool: 'any', carrier: 'as64501|residential' }));
    await waitFor(() => expect(result.current.data?.total).toBe(1));
    expect(fetcher).toHaveBeenCalledWith('/api/pool/stock/facets?country=us&pool=all&carrier=as64501%7Cresidential', expect.any(Object));
  });

  it.each([['mbl', 'mbl'], ['peer', 'all']])('private pool %s reads %s stock including modem providers', async (token, scope) => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), 'https://fixture.test');
      if (url.pathname.endsWith('/leases')) return new Response(JSON.stringify({ enabled: true, maxLeases: 10, poolHeld: 0, leases: [], gateway: { proxyUsername: 'psx_fixture', poolToken: token, countries: ['us'], host: 'fixture.test', httpPort: 7000, socksPort: 7001 } }));
      if (url.pathname.endsWith('/stock/carriers')) return new Response(JSON.stringify({ country: 'us', total: 35, other: 0, carriers: [{ name: 'Example Mobile', asn: null, count: 35, ipType: 'mobile', classification: { type: 'mobile', basis: 'modem' } }] }));
      throw new Error('Unexpected fixture route');
    });
    globalThis.fetch = fetcher as typeof fetch;
    render(<PrivatePoolPanel pak="fixture" proxyUsername="psx_fixture" apiRoute="/api/pool" />);
    await screen.findByRole('option', { name: 'Example Mobile (mobile network; reported mobile) — 35' });
    expect(fetcher.mock.calls.some(([url]) => String(url) === `/api/pool/stock/carriers?country=us&pool=${scope}`)).toBe(true);
  });

  it('keeps a missing private provider and sends its original reservation only after recovery', async () => {
    const writes: unknown[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://fixture.test');
      if (init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ message: 'Fixture captured' }), { status: 409 });
      }
      if (url.pathname.endsWith('/leases')) return new Response(JSON.stringify({ enabled: true, maxLeases: 10, poolHeld: 0, leases: [], gateway: { proxyUsername: 'psx_fixture', poolToken: 'mbl', countries: ['us'], host: 'fixture.test', httpPort: 7000, socksPort: 7001 } }));
      return new Response(JSON.stringify({ country: 'us', total: 3, other: 0, carriers: url.pathname.startsWith('/empty') ? [] : [{ name: 'Example Mobile', asn: null, count: 3, ipType: 'mobile' }] }));
    }) as typeof fetch;
    const props = { pak: 'fixture', proxyUsername: 'psx_fixture' };
    const view = render(<PrivatePoolPanel {...props} apiRoute="/api/pool" />);
    await screen.findByRole('option', { name: /Example Mobile/ });
    fireEvent.change(screen.getByRole('combobox', { name: /^Carrier\b/ }), { target: { value: 'Example Mobile' } });
    view.rerender(<PrivatePoolPanel {...props} apiRoute="/empty" />);
    await screen.findByRole('option', { name: /Selected carrier unavailable/ });
    const reserve = screen.getByRole('button', { name: 'Reserve 1 IP' });
    expect(reserve).toBeDisabled();
    fireEvent.click(reserve);
    expect(writes).toHaveLength(0);
    view.rerender(<PrivatePoolPanel {...props} apiRoute="/api/pool" />);
    await waitFor(() => expect(reserve).toBeEnabled());
    fireEvent.click(reserve);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ country: 'us', carrier: 'Example Mobile' });
    expect(writes[0]).not.toHaveProperty('asn');
  });

  it('keeps a missing spawner carrier and resumes its original ASN when stock returns', async () => {
    const stock = [{ asn: 64501, name: 'Example Network', count: 7, ipType: 'residential' }];
    const onSpawn = vi.fn();
    const props = { proxyUsername: 'psx_fixture', proxyPassword: 'fixture', countries: ['us'], defaultPool: 'peer' as const, onSpawn };
    const view = render(<PoolSessionSpawner {...props} carrierStock={stock} />);
    fireEvent.change(screen.getByLabelText('Carrier / ISP'), { target: { value: 'Example Network|residential' } });
    view.rerender(<PoolSessionSpawner {...props} carrierStock={[]} />);
    const generate = screen.getByRole('button', { name: /Generate .*proxy URL/ });
    expect(generate).toBeDisabled();
    expect(screen.getByRole('option', { name: /Selected carrier unavailable/ })).toBeInTheDocument();
    fireEvent.click(generate);
    expect(onSpawn).not.toHaveBeenCalled();
    view.rerender(<PoolSessionSpawner {...props} carrierStock={stock} />);
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    expect(onSpawn).toHaveBeenCalledOnce();
    expect(onSpawn.mock.calls[0][0].every((url: string) => url.includes('-asn-64501'))).toBe(true);
  });

  it('does not present a reported residential class as a verified network category', () => {
    render(<PoolSessionSpawner proxyUsername="psx_fixture" proxyPassword="fixture" countries={['us']} defaultPool="peer" carrierStock={[{ asn: 64501, name: 'Example Network', count: 7, ipType: 'residential', classification: { type: 'unknown', basis: 'unverified' } }]} />);
    expect(screen.getByRole('option', { name: 'All carriers / ISPs' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Example Network (category unknown; reported residential) — 7' })).toBeInTheDocument();
  });
});
