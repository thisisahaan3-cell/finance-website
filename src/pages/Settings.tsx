import { useState } from 'react';
import { Page } from '../components/Page';
import { Card, KV, Note, NumberField, PercentField, Seg, toast } from '../components/ui';
import { clearCache } from '../lib/data/api';
import { download, readFile } from '../lib/csv';
import { dateTime, todayIso } from '../lib/format';
import { DEFAULT_SETTINGS, exportBackup, importBackup, resetAll, setSettings, useStore } from '../lib/store';

export default function Settings() {
  const s = useStore((x) => x.settings);
  // primitives only: a selector must not build a new object on every call
  const counts = {
    portfolios: useStore((x) => x.portfolios.length),
    txns: useStore((x) => x.portfolios.reduce((n, p) => n + p.txns.length, 0)),
    watch: useStore((x) => x.watchlist.length),
    saved: useStore((x) => Object.keys(x.saved).length),
    lessons: useStore((x) => x.lessonsDone.length),
  };
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setStatus(null);
    const t0 = performance.now();
    try {
      const res = await fetch('/api/quote?symbols=%5ENSEI', { cache: 'no-store' });
      const body = await res.json();
      const q = body?.quotes?.[0];
      if (!res.ok || !q) throw new Error(body?.error ?? `Error ${res.status}`);
      setStatus({ ok: true, text: `Working. NIFTY 50 at ${q.regularMarketPrice} as of ${dateTime((q.regularMarketTime ?? 0) * 1000)}. Response in ${Math.round(performance.now() - t0)} ms.` });
    } catch (e) {
      setStatus({ ok: false, text: `Not reachable: ${(e as Error).message}. Calculators still work; anything needing market data will show an error until this recovers.` });
    }
    setChecking(false);
  };

  return (
    <Page title="Data & settings" crumb="App" lede="Your data stays in this browser. Back it up, move it to another device, or change the assumptions used across the site.">
      <div className="grid cols-2">
        <Card title="Your saved data">
          <KV
            rows={[
              ['Portfolios', counts.portfolios],
              ['Transactions', counts.txns],
              ['Watchlist items', counts.watch],
              ['Tools with saved inputs', counts.saved],
              ['Lessons completed', counts.lessons],
            ]}
          />
          <div className="row mt">
            <button className="btn primary sm" onClick={() => { download(`artha-backup-${todayIso()}.json`, exportBackup(), 'application/json'); toast('Backup downloaded'); }}>
              Export backup
            </button>
            <label className="btn sm">
              Restore from backup
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  setError(null);
                  if (!window.confirm('Restoring replaces everything currently saved in this browser with the contents of the backup file. Continue?')) return;
                  try {
                    importBackup(await readFile(f));
                    toast('Backup restored');
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              />
            </label>
            <button
              className="btn sm danger"
              onClick={() => {
                if (window.confirm('Delete all portfolios, watchlist, saved inputs and settings from this browser? This cannot be undone. Export a backup first if you might want them back.')) {
                  resetAll();
                  toast('All data deleted');
                }
              }}
            >
              Delete everything
            </button>
          </div>
          {error && <Note kind="err" className="mt-s">{error}</Note>}
          <p className="small muted mt-s">Everything is stored in this browser on this device only: there are no accounts and nothing is uploaded. Clearing your browser's site data deletes it, so export a backup now and then. To move to another device, export here and restore there.</p>
        </Card>
        <Card title="Assumptions used across the site">
          <div className="form">
            <div className="form two">
              <PercentField label="Risk-free rate" value={s.riskFree} onChange={(riskFree) => setSettings({ riskFree })} min={0} max={0.25} tip="The return available with no risk: usually the 10-year Indian government bond yield. Used in Sharpe ratios and the cost of equity. Check the current yield on the RBI or CCIL website." />
              <PercentField label="Long-run inflation" value={s.inflation} onChange={(inflation) => setSettings({ inflation })} min={0} max={0.25} tip="Used as the default when a tool shows amounts in today's money." />
              <NumberField label="Large cap: market value above" suffix="₹ Cr" value={s.largeCapMinCr} onChange={(largeCapMinCr) => setSettings({ largeCapMinCr })} min={1} decimals={0} grouping="IN" tip="SEBI defines large caps as the 100 biggest listed companies by market value, mid caps as the next 150. AMFI publishes the list twice a year; these rupee cut-offs are an approximation you can update." />
              <NumberField label="Mid cap: market value above" suffix="₹ Cr" value={s.midCapMinCr} onChange={(midCapMinCr) => setSettings({ midCapMinCr })} min={1} decimals={0} grouping="IN" />
            </div>
            <div className="field">
              <span className="label">Appearance</span>
              <Seg options={[{ value: 'system', label: 'Match my device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} value={s.theme} onChange={(theme) => setSettings({ theme })} />
            </div>
            <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => setSettings({ ...DEFAULT_SETTINGS, theme: s.theme })}>
              Restore default assumptions
            </button>
          </div>
        </Card>
        <Card title="Market data">
          <KV
            rows={[
              ['Provider', 'Yahoo Finance'],
              ['Indian prices', 'Delayed about 15 minutes'],
              ['History', 'Daily, adjusted for splits and dividends'],
              ['Fundamentals', 'Trailing twelve months and annual statements'],
            ]}
          />
          <div className="row mt">
            <button className="btn sm" onClick={check} disabled={checking}>
              {checking ? 'Checking…' : 'Check the data connection'}
            </button>
            <button className="btn sm" onClick={async () => { await clearCache(); toast('Cached market data cleared'); }}>
              Clear cached market data
            </button>
          </div>
          {status && <Note kind={status.ok ? 'ok' : 'err'} className="mt-s">{status.text}</Note>}
          <p className="small muted mt-s">Data is fetched only when a page needs it and kept in this browser for a short while (minutes for prices, hours for company figures) so pages load quickly and the provider is not overloaded. Yahoo's data is unofficial, free and occasionally wrong: verify anything important against the company's filings or the exchange.</p>
        </Card>
        <Card title="About Artha">
          <p className="small dim">Artha (अर्थ) is the Sanskrit word for wealth and purpose. This site is a workbench for learning finance by doing it: every tool shows its working, and every number can be traced to an input or a source.</p>
          <ul className="small dim" style={{ paddingLeft: 18, margin: 0 }}>
            <li>It is not investment, tax or legal advice, and it never places trades.</li>
            <li>Calculations run in your browser. The formulas are tested against published reference values.</li>
            <li>Made by Ahaan Gupta.</li>
          </ul>
        </Card>
      </div>
    </Page>
  );
}
