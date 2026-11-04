import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { config } from '@/config';
import { PoolPortal } from '@proxies-sx/pool-portal-react';

interface PurchaseRow {
  id: number;
  stripe_session_id: string;
  amount_usd_cents: number;
  gb_purchased: string;
  tier_id: string;
  created_at: Date;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/dashboard');

  const userId = Number((session.user as { id?: string }).id);

  const customer = await queryOne<{ pak_key_id: string | null; total_gb_purchased: string }>(
    'SELECT pak_key_id, total_gb_purchased FROM customers WHERE user_id = $1',
    [userId],
  );

  const recentPurchase = await queryOne<PurchaseRow>(
    'SELECT id, stripe_session_id, amount_usd_cents, gb_purchased, tier_id, created_at FROM purchases WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId],
  );

  // No key yet — prompt purchase
  if (!customer?.pak_key_id) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Welcome{session.user.name ? `, ${session.user.name}` : ''}</h1>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <p className="text-slate-600 dark:text-slate-400">
            You don't have an active proxy yet. Pick a plan to get your credentials.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {config.pricing.map((tier) => (
              <Link
                key={tier.id}
                href={`/api/stripe/checkout?tier=${tier.id}`}
                className="px-4 py-2 rounded-md bg-[var(--brand)] text-[var(--brand-fg)] hover:opacity-90"
              >
                {tier.displayName} — {tier.gb} GB for ${tier.priceUsd}
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Your proxy</h1>
          <p className="text-sm text-slate-500">
            {Number(customer.total_gb_purchased).toFixed(0)} GB purchased lifetime
          </p>
        </div>
        <Link
          href="/#pricing"
          className="text-sm px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Buy more GB
        </Link>
      </div>

      <PoolPortal
        pool="mbl"
        apiRoute="/api/pool"
        countries={[...config.countries]}
        branding={{
          name: config.brand.name,
          primaryColor: config.brand.primaryColor,
          accentColor: config.brand.accentColor,
          logoUrl: config.brand.logoUrl || undefined,
        }}
      />

      {recentPurchase && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold mb-3">Recent purchase</h2>
          <div className="text-sm flex items-center justify-between">
            <span className="text-slate-600 dark:text-slate-400">
              {recentPurchase.tier_id} · {Number(recentPurchase.gb_purchased).toFixed(0)} GB
            </span>
            <span className="font-medium tabular-nums">
              ${(recentPurchase.amount_usd_cents / 100).toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
