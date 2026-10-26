/* The Command 57 finance / market validator tests (ap3x-kiosk-displays deploy/test_ucs_layout_v2_data.cjs),
 * run against the console's TypeScript port. */
import { describe, expect, it } from "vitest";
import * as data from "../src/modules/markets/summaries";

const eq = (actual: unknown, expected: unknown) => expect(actual).toBe(expected);
/* eslint-disable @typescript-eslint/no-explicit-any */
const NOW = Date.parse('2026-10-10T12:00:00Z');
const STAMP = '2026-10-10T11:59:00Z';

function finance(): any {
  return {
    accounts: { taxable: { account_value: '100.00' },
      roth_ira: { account_value: '200.00' }, agentic: { equity: '300.00' },
      smart_income: { market_value: '400.00' } },
    coverage: { complete: true, available_account_count: 4,
      missing_accounts: [], unexpected_accounts: [], duplicate_accounts: [] },
    all_accounts_total: 1000, broker_snapshot: { fresh: true, age_seconds: 60 },
    reader: { status: 'RUNNING', accounts_observed_at: STAMP }
  };
}

describe("finance and market summaries (parity with Command 57)", () => {
it('finance total is withheld until all four accounts reconcile', () => {
  eq(data.summarizeFinance(finance(), NOW).combinedEquity, 1000);
  const blank = finance();
  blank.accounts.taxable.account_value = '';
  eq(data.summarizeFinance(blank, NOW).combinedEquity, null);
  const missing = finance();
  delete missing.accounts.agentic;
  eq(data.summarizeFinance(missing, NOW).combinedEquity, null);
  const mismatch = finance();
  mismatch.all_accounts_total = 1001;
  eq(data.summarizeFinance(mismatch, NOW).combinedEquity, null);
  const coverageFault = finance();
  coverageFault.coverage.duplicate_accounts = ['taxable'];
  eq(data.summarizeFinance(coverageFault, NOW).combinedEquity, null);
});

it('closed market quotes remain visible as retained observations', () => {
  const market: any = { generated_at: STAMP, session: 'closed',
    health: { active_trading_session: false, scan_quality: 'session_closed',
      state_stale: false, scan_complete: true },
    prices: { VOO: { price: 555.25, available: true,
      move_5m_pct: null, move_15m_pct: null, fresh_for_trading: false },
      BROKEN: { price: null, available: false } } };
  const result = data.summarizeMarkets(market, NOW);
  eq(result.state, 'live');
  eq(result.quoteMode, 'retained');
  eq(result.quotes.VOO!.retained, true);
  eq(result.quotes.VOO!.move5mPct, null);
  eq(result.quotes.BROKEN, undefined);
});

it('open-session market moves are shown only when supplied by a valid quote', () => {
  const market: any = { generated_at: STAMP, session: 'regular',
    health: { active_trading_session: true, scan_complete: true,
      state_stale: false, symbols_expected: 1, fresh_quote_count: 1,
      fetch_failure_count: 0 },
    prices: { VOO: { price: 555.25, available: true,
      fresh_for_trading: true, move_5m_pct: 0.3, move_15m_pct: -0.2 } } };
  const result = data.summarizeMarkets(market, NOW);
  eq(result.quoteMode, 'trading');
  eq(result.quotes.VOO!.move5mPct, 0.3);
  eq(result.quotes.VOO!.move15mPct, -0.2);
  eq(result.quotes.VOO!.freshForTrading, true);
});

});
