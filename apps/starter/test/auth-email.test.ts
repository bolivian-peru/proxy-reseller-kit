import { afterEach, expect, it, vi } from 'vitest';
import Nodemailer from 'next-auth/providers/nodemailer';

vi.mock('next-auth', () => ({ default: () => ({}) }));
vi.mock('next-auth/providers/nodemailer', () => ({ default: vi.fn() }));
vi.mock('../src/lib/db', () => ({ pool: {} }));

const url = 'http://localhost/login?token=test-only';
const identifier = 'test@example.invalid';

async function emailOptions() {
  await import('../src/lib/auth');
  return vi.mocked(Nodemailer).mock.calls[0][0];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

it.each([
  ['production', '', ''],
  ['production', '  ', identifier],
  ['production', 'smtp.example.invalid', '  '],
  ['test', '', ''],
  [undefined, '', ''],
])('rejects incomplete mail settings in %s with host "%s" and sender "%s"', async (mode, host, from) => {
  vi.stubEnv('NODE_ENV', mode);
  vi.stubEnv('EMAIL_SERVER_HOST', host);
  vi.stubEnv('EMAIL_FROM', from);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { sendVerificationRequest } = await emailOptions();
  const request = { url, identifier } as Parameters<NonNullable<typeof sendVerificationRequest>>[0];
  await expect(sendVerificationRequest!(request)).rejects.toThrow(
    'Email delivery requires EMAIL_SERVER_HOST and EMAIL_FROM.',
  );
  expect(log).not.toHaveBeenCalled();
});

it('keeps local sign-in available in development', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('EMAIL_SERVER_HOST', '');
  vi.stubEnv('EMAIL_FROM', '');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { sendVerificationRequest } = await emailOptions();
  await sendVerificationRequest!({ url, identifier } as Parameters<NonNullable<typeof sendVerificationRequest>>[0]);
  expect(log).toHaveBeenCalledWith('Local sign-in link:', url);
});

it('uses normal SMTP delivery when the host and sender are configured', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('EMAIL_SERVER_HOST', ' smtp.example.invalid ');
  vi.stubEnv('EMAIL_FROM', ` ${identifier} `);
  const options = await emailOptions();
  expect(options.from).toBe(identifier);
  expect(options.server).toMatchObject({ host: 'smtp.example.invalid' });
  expect(options.sendVerificationRequest).toBeUndefined();
});
