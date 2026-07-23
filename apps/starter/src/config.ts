/**
 * Single source of truth for everything a reseller wants to customize.
 *
 * Edit these values, not the source elsewhere. If you're an AI agent helping a
 * human customize their deployment, ALL common edits should happen in this file.
 */

import type { Country } from '@proxies-sx/pool-sdk';

export interface PricingTier {
  /** Stable identifier used in Stripe metadata and purchase records. */
  id: string;
  /** Shown on the landing page. */
  displayName: string;
  /** Gigabytes of traffic included. */
  gb: number;
  /** Price in US dollars (not cents). Stripe conversion happens in checkout handler. */
  priceUsd: number;
  /** Optional marketing tagline. */
  tagline?: string;
}

export const config = {
  brand: {
    /** Shop name shown in the header, emails, and page titles. */
    name: 'Pool Portal',
    /** Tagline on the landing page. */
    tagline: 'Mobile & residential proxies. One endpoint. Pay by the gigabyte.',
    /** Support contact — shown in the footer and in email templates. */
    supportEmail: 'support@example.com',
    /** Primary brand color — CSS color string. Drives the button and accent. */
    primaryColor: '#6366f1',
    /** Accent color — used for usage bars and success states. */
    accentColor: '#10b981',
    /** Optional absolute URL to a logo image. If set, replaces the text name in the dashboard header. */
    logoUrl: '' as string,
  },

  /**
   * Pricing tiers shown on the landing page and offered in Stripe checkout.
   * Wholesale rates have volume tiers — check your client.proxies.sx
   * dashboard or api.proxies.sx/v1/x402/pricing for current values.
   * Your retail markup is whatever you set below.
   */
  pricing: [
    { id: 'starter', displayName: 'Starter', gb: 5, priceUsd: 35, tagline: 'Kick the tires' },
    { id: 'pro', displayName: 'Pro', gb: 25, priceUsd: 150, tagline: 'For active projects' },
    { id: 'scale', displayName: 'Scale', gb: 100, priceUsd: 500, tagline: 'Best per-GB rate' },
  ] satisfies PricingTier[],

  /** Countries the dashboard offers in the dropdown. Must be supported by the pool. */
  countries: ['us', 'gb', 'fr', 'nl', 'pl', 'ge'] satisfies Country[],

  /** Default landing page CTA label. */
  primaryCta: 'Get started',

  legal: {
    tosUrl: '/terms',
    privacyUrl: '/privacy',
  },
} as const;

export type Config = typeof config;

/** Lookup a tier by id. Throws if the id isn't in the config. */
export function tierById(id: string): PricingTier {
  const tier = config.pricing.find((t) => t.id === id);
  if (!tier) throw new Error(`Unknown pricing tier: ${id}`);
  return tier;
}
