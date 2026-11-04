import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PakQuickstart } from '../src/PakQuickstart';
import { PoolDocsPanel } from '../src/PoolDocsPanel';

afterEach(cleanup);

const credentials = { proxyUsername: 'psx_example', pak: 'pak_fixture_only' };

describe('quickstart usage observations', () => {
  it.each([undefined, NaN, Infinity, -1])('does not turn unknown or invalid usage (%s) into zero', (usedGB) => {
    const { container } = render(<PakQuickstart {...credentials} capGB={10} usedGB={usedGB} />);
    expect(screen.getByRole('status').textContent).toContain('Traffic usage is unavailable');
    expect(container.querySelector('.pp-pakquick__meter')).toBeNull();
  });

  it('retains a valid measured zero and shows the explicit modem-pool choice', () => {
    render(<PakQuickstart {...credentials} capGB={10} usedGB={0} />);
    expect(screen.getByText('0.00 GB / 10.00 GB')).toBeTruthy();
    expect(screen.getByText(/explicitly selects the shared carrier-modem pool/)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not hide observed overshoot behind the capped progress bar', () => {
    render(<PakQuickstart {...credentials} capGB={1} usedGB={2.2} />);
    expect(screen.getByText('2.20 GB / 1.00 GB')).toBeTruthy();
  });
});

describe('pool help contract', () => {
  it('distinguishes binding release, asynchronous metering and timed selection from guarantees', () => {
    const { container } = render(<PoolDocsPanel />);
    const text = container.textContent ?? '';
    expect(text).toContain('does not close existing sockets');
    expect(text).toContain('stale or missing readings remain unknown');
    expect(text).toContain('a different IP');
    expect(text).not.toContain('under 200 ms');
    expect(text).not.toContain('updates within ~5–15 s');
    expect(text).not.toContain('different device every 5 minutes');
  });
});
