const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.POOL_WORKSPACE_COMPILED;
if (!root) throw new Error('Set POOL_WORKSPACE_COMPILED to the isolated TypeScript output directory');
const model = require(path.join(root, 'docs/examples/pool-workspace/model.js'));
const now = Date.parse('2026-11-05T12:00:00Z');
const stock = { pools: { peer: { US: 4, gb: 2 }, mbl: { us: 3 } }, totals: { peer: 6, mbl: 3, all: 9 }, generatedAt: new Date(now).toISOString() };
const settings = { pool: 'peer', country: 'us', protocol: 'http', rotation: 'auto10', ttl: 3600, sid: 'fixture_saved_1' };
const list = { id: 'local-1', name: 'Research', createdAt: new Date(now).toISOString(), included: true, configurations: [settings] };

test('all UI/discovery scope becomes any only in the connection', () => {
  assert.deepEqual(model.poolScopes('all'), { connection: 'any', discovery: 'all' });
  assert.deepEqual(model.poolScopes('private-devices'), { connection: 'mbl', discovery: 'mbl' });
  assert.throws(() => model.poolScopes(undefined));
});
test('fresh scoped country counts distinguish zero from unavailable/stale/malformed', () => {
  assert.deepEqual(model.countryAvailability(stock, 'all', 'us', now), { state: 'available', count: 7 });
  assert.deepEqual(model.countryAvailability(stock, 'private-devices', 'gb', now), { state: 'empty', count: 0 });
  assert.equal(model.countryAvailability(stock, 'peer', 'us', now + 90_001).state, 'unknown');
  assert.equal(model.countryAvailability({ ...stock, stale: true }, 'peer', 'us', now).state, 'unknown');
  assert.equal(model.countryAvailability({ ...stock, pools: {} }, 'peer', 'us', now).state, 'unknown');
  assert.equal(model.countryAvailability({ ...stock, pools: { ...stock.pools, peer: { us: -1 } } }, 'peer', 'us', now).state, 'unknown');
});
test('geo filters preserve all/any routing but never permit impossible modem geo', () => {
  const url = model.exportConfiguration({ ...settings, pool: 'all', city: 'fixturecity' }, 'psx_fixture', 'pak_fixture');
  assert.match(url, /-any-us-city-fixturecity-sid-fixture_saved_1/);
  assert.throws(() => model.exportConfiguration({ ...settings, pool: 'private-devices', city: 'fixturecity' }, 'psx_fixture', 'pak_fixture'));
  assert.throws(() => model.exportConfiguration({ ...settings, pool: 'private-devices', ipType: 'residential' }, 'psx_fixture', 'pak_fixture'));
});
test('saved lists whitelist settings, retain stable SIDs and use current secrets only at export', () => {
  const text = model.serializeSavedLists([{ ...list, password: 'do_not_store', configurations: [{ ...settings, proxyPassword: 'do_not_store' }] }]);
  assert.ok(!text.includes('do_not_store'));
  const restored = model.parseSavedLists(text);
  const first = model.copyIncludedLists(restored, 'psx_fixture', 'pak_first_fixture');
  const second = model.copyIncludedLists(restored, 'psx_fixture', 'pak_second_fixture');
  assert.match(first, /-sid-fixture_saved_1/);
  assert.match(second, /-sid-fixture_saved_1/);
  assert.ok(!second.includes('pak_first_fixture'));
});
test('include/exclude changes copy-all, not the saved configuration or credential', () => {
  const excluded = [{ ...list, included: false }];
  assert.equal(model.copyIncludedLists(excluded, 'psx_fixture', 'pak_fixture'), '');
  assert.deepEqual(excluded[0].configurations, list.configurations);
  assert.equal(model.copyIncludedLists([], 'psx_fixture', 'pak_fixture'), '');
});
test('newest 50 remain, duplicate list replaces once, corrupt storage stays an error', () => {
  const older = Array.from({ length: 50 }, (_, i) => ({ ...list, id: `old-${i}` }));
  const retained = model.prependSavedList(older, list);
  assert.equal(retained.length, 50);
  assert.equal(retained[0].id, 'local-1');
  assert.equal(retained.at(-1).id, 'old-48');
  assert.equal(model.prependSavedList(retained, list).filter(v => v.id === list.id).length, 1);
  assert.throws(() => model.parseSavedLists('{corrupt'));
  assert.throws(() => model.parseSavedLists('[{}]'));
  assert.deepEqual(model.parseSavedLists(null), []);
});
test('SOCKS output uses 7001 and keeps the same saved SID', () => {
  const url = model.exportConfiguration({ ...settings, protocol: 'socks5' }, 'psx_fixture', 'pak_fixture');
  assert.match(url, /^socks5:\/\//);
  assert.match(url, /-sid-fixture_saved_1/);
  assert.match(url, /:7001$/);
});
test('weighted balance estimates do not change raw customer quota or assume missing pricing', () => {
  const pricing = { live: true, defaultTier: 3, tiers: [
    { tier: 2, name: 'Fixture plus', countries: ['xx'], burnRate: 0.375, pricePerGB: 1.5 },
    { tier: 3, name: 'Fixture standard', countries: null, burnRate: 0.1875, pricePerGB: 0.75 },
  ] };
  assert.equal(model.weightedBalanceEstimate(1, 'xx', pricing), 0.375);
  assert.equal(model.weightedBalanceEstimate(1, 'yy', pricing), 0.1875);
  assert.equal(model.weightedBalanceEstimate(1, 'xx', { ...pricing, live: false }), 1);
  assert.equal(model.weightedBalanceEstimate(1, 'xx', null), null);
  assert.equal(model.weightedBalanceEstimate(-1, 'xx', pricing), null);
  assert.equal(model.weightedBalanceEstimate(1, 'xx', { live: true, tiers: null }), null);
  assert.equal(model.weightedBalanceEstimate(1, 'xx', { live: 'false', tiers: [] }), null);
});

for (const [field, value] of [
  ['city', ['brooklyn']], ['carrier', 123], ['state', null], ['isp', {}],
  ['city', false], ['carrier', ''], ['ipType', 0], ['ipType', false],
  ['ipType', null], ['ipType', ''], ['failover', false], ['failover', 0],
  ['failover', null], ['failover', ''],
]) {
  test(`malformed ${field}=${JSON.stringify(value)} cannot persist or silently widen export`, () => {
    const bad = { ...settings, [field]: value };
    const json = JSON.stringify([{ ...list, configurations: [bad] }]);
    assert.throws(() => model.parseSavedLists(json));
    assert.throws(() => model.exportConfiguration(bad, 'psx_fixture', 'pak_fixture'));
  });
}
test('malformed copy inclusion stays an error rather than a silent exclusion', () => {
  assert.throws(() => model.parseSavedLists(JSON.stringify([{ ...list, included: 0 }])));
});

test('strict sticky cannot silently disappear from a timed configuration', () => {
  assert.throws(() => model.exportConfiguration({ ...settings, strict: true }, 'psx_fixture', 'pak_fixture'));
  assert.doesNotThrow(() => model.exportConfiguration({ ...settings, strict: false }, 'psx_fixture', 'pak_fixture'));
  const url = model.exportConfiguration({ ...settings, strict: true, rotation: 'sticky' }, 'psx_fixture', 'pak_fixture');
  assert.match(url, /-rot-sticky-strict/);
});
