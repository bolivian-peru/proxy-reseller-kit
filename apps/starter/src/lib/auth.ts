import NextAuth, { type NextAuthConfig } from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import PostgresAdapter from '@auth/pg-adapter';
import { pool } from './db';

const smtpHost = process.env.EMAIL_SERVER_HOST?.trim();
const emailFrom = process.env.EMAIL_FROM?.trim();
const hasSmtpConfig = Boolean(smtpHost && emailFrom);

/**
 * NextAuth (Auth.js v5) configuration.
 *
 * Strategy:
 *   - Database sessions (not JWT) — survives signouts via session table
 *   - Magic-link email via Nodemailer (any SMTP server works)
 *   - Dev fallback: when SMTP isn't configured, print the login link to
 *     the server console so you can click through without setting up email
 */
const config: NextAuthConfig = {
  adapter: PostgresAdapter(pool),
  trustHost: process.env.AUTH_TRUST_HOST === 'true',
  session: { strategy: 'database' },
  pages: {
    signIn: '/login',
    verifyRequest: '/login?verify=1',
  },
  providers: [
    Nodemailer({
      // Auth.js requires a `server` value even when sendVerificationRequest is
      // overridden. With incomplete SMTP settings the callback handles delivery
      // and Auth.js never connects to the placeholder server.
      server: hasSmtpConfig
        ? {
            host: smtpHost,
            port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
            auth:
              process.env.EMAIL_SERVER_USER && process.env.EMAIL_SERVER_PASSWORD
                ? {
                    user: process.env.EMAIL_SERVER_USER,
                    pass: process.env.EMAIL_SERVER_PASSWORD,
                  }
                : undefined,
          }
        : { host: '127.0.0.1', port: 25, auth: undefined },
      from: emailFrom || 'noreply@localhost',
      sendVerificationRequest: hasSmtpConfig
        ? undefined
        : async ({ url }) => {
            if (process.env.NODE_ENV !== 'development') {
              throw new Error('Email delivery requires EMAIL_SERVER_HOST and EMAIL_FROM.');
            }
            console.log('Local sign-in link:', url);
          },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      // Expose the numeric users.id to server components via `session.user.id`.
      if (session.user && user) {
        (session.user as { id?: string }).id = user.id;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
