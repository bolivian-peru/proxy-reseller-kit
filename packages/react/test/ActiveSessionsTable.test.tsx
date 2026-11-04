import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ActiveSessionsTable } from '../src/ActiveSessionsTable';

const session = {
  sessionKey: 'fixture_binding', sessionId: 'saved_workflow', country: 'us', pool: 'peer',
  bindingGeneration: 'be275211-aaf2-49cf-a809-5484509d2739',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('session inventory and release evidence', () => {
  it('retains rows after malformed refresh and never claims empty inventory', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ sessions: [session] }))
      .mockResolvedValueOnce(json({ error: 'read_failed' }));
    vi.stubGlobal('fetch', fetcher);
    render(<ActiveSessionsTable proxyPassword="fixture" refreshIntervalMs={0} />);
    await screen.findByText('saved_workflow');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText(/inventory is unavailable/);
    expect(screen.getByText('saved_workflow')).toBeInTheDocument();
    expect(screen.queryByText(/No bindings were observed/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Release all' })).toBeDisabled();
  });

  it('exposes truncation and refuses bulk release', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ sessions: [session], truncated: true }));
    vi.stubGlobal('fetch', fetcher);
    render(<ActiveSessionsTable proxyPassword="fixture" refreshIntervalMs={0} />);
    await screen.findByText(/Partial inventory/);
    expect(screen.getByRole('button', { name: 'Release all' })).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('checks success:false and forwards the observed generation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ sessions: [session] }))
      .mockResolvedValueOnce(json({ success: false }));
    vi.stubGlobal('fetch', fetcher);
    const acknowledged = vi.fn();
    render(<ActiveSessionsTable proxyPassword="fixture" refreshIntervalMs={0} onSessionClosed={acknowledged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release saved_workflow' }));
    await screen.findByText(/Release was not confirmed/);
    expect(acknowledged).not.toHaveBeenCalled();
    expect(screen.getByText('saved_workflow')).toBeInTheDocument();
    expect(fetcher.mock.calls[1][0]).toContain(`?generation=${session.bindingGeneration}`);
  });

  it('does not retry an ambiguous release after an empty refresh', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ sessions: [session] }))
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockResolvedValueOnce(json({ sessions: [] }))
      .mockResolvedValueOnce(json({ sessions: [session] }));
    vi.stubGlobal('fetch', fetcher);
    render(<ActiveSessionsTable proxyPassword="fixture" refreshIntervalMs={0} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release saved_workflow' }));
    await screen.findByText(/Release outcome is unknown/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText(/No bindings were observed/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('saved_workflow');
    expect(screen.getByRole('button', { name: 'Release saved_workflow' })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });

  it('does not turn a failing host callback into an unknown mutation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ sessions: [session] }))
      .mockResolvedValueOnce(json({ success: true })));
    render(<ActiveSessionsTable proxyPassword="fixture" refreshIntervalMs={0}
      onSessionClosed={() => { throw new Error('host callback failed'); }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release saved_workflow' }));
    await screen.findByText(/release was acknowledged/);
    await waitFor(() => expect(screen.queryByText('saved_workflow')).not.toBeInTheDocument());
    expect(screen.queryByText(/outcome is unknown/)).not.toBeInTheDocument();
  });
});
