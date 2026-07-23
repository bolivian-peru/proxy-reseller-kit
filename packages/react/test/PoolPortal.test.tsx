import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PoolPortal } from '../src/PoolPortal';
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
