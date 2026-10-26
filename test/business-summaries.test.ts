/* The Command 57 validator tests (ap3x-kiosk-displays deploy/test_ucs_layout_v2_data.cjs), run against
 * the console's TypeScript port so the two keep accepting and rejecting the same feeds. */
import { describe, expect, it } from "vitest";
import * as data from "../src/modules/business/summaries";

const eq = (actual: unknown, expected: unknown) => expect(actual).toBe(expected);
const notMatch = (text: string, pattern: RegExp) => expect(text).not.toMatch(pattern);
/* eslint-disable @typescript-eslint/no-explicit-any */
const NOW = Date.parse('2026-10-10T12:00:00Z');
const STAMP = '2026-10-10T11:59:00Z';

function business(): any {
  return {
    protocol: 'ap3x.business-ops.v1', schema_version: 2, updated_at: STAMP,
    deadlines: [
      { active: true, complete: false, due: '2026-10-09' },
      { active: true, complete: false, due: '2026-10-12' },
      { active: true, complete: false, due: null },
      { active: true, complete: true, due: '2026-10-10' }
    ]
  };
}

function ledger(): any {
  return {
    protocol: 'ap3x.deductions-wall.v2', schema_version: 2,
    revision: 'DLW003-20261010T115900Z', generated_at: STAMP,
    source: { workbook: 'AP3X Operations LLC 2026 Deductions Ledger',
      tax_year: 2026, bookkeeping_basis: 'Cash basis',
      timezone: 'America/New_York' },
    privacy: { sanitized_summary_only: true, transaction_details: false,
      receipt_links: false, identifiers: false },
    review: { missing_receipts: 2, incomplete_mileage: 0,
      classification_gaps: 1, assets_awaiting_review: 1,
      app_workflow_exceptions: 1, total_open: 5 }
  };
}

function receipts(): any {
  return {
    protocol: 'ap3x.ledger-activity.v1', schema: 1, status: 'ready',
    revision: 'LFA001-20261010T115900Z', generated_at: STAMP,
    source: 'cash_inflow_ledger', currency: 'USD', year: 2026,
    included_in_bank_totals: false,
    income: { gross_received: 1200, receipt_count: 1,
      recorded_since: '2026-10-01', as_of: '2026-10-01',
      deposited: 0, undeposited: 1200, deposit_unknown: 0 },
    latest: { received_on: '2026-10-01', amount: 1200,
      deposit_status: 'undeposited', allocations: null }
  };
}

function bank(): any {
  return {
    connection_status: 'connected', sync_status: 'ok', error: false,
    last_successful_sync: STAMP,
    accounts: [{ alias: 'fictional name should never escape', current: 777,
      currency: 'USD', account_id: 'fictional-id' }],
    activity: { protocol: 'ap3x.business-activity.v1', schema: 1,
      status: 'ready', currency: 'USD', as_of: STAMP,
      month: { start: '2026-10-01', end: '2026-10-10',
        money_in: '500.00', money_out: '175.00', net: '325.00',
        transaction_count: 3 },
      daily: Array.from({ length: 30 }, (_, offset) => ({
        date: `2026-09-${String(offset + 1).padStart(2, '0')}`,
        money_in: '0.00', money_out: '0.00', net: '0.00', transaction_count: 0
      })) }
  };
}


describe("business summaries (parity with Command 57)", () => {
it('business summary keeps receipt, bank, review, and deadlines independent', () => {
  const result = data.summarizeBusiness({ business: business(), ledger: ledger(),
    ledgerActivity: receipts(), bank: bank() }, NOW);
  eq(result.state, 'live');
  eq(result.current.openDeadlines, 3);
  eq(result.current.overdue, 1);
  eq(result.current.dueSoon, 1);
  eq(result.current.nextDueDays, -1);
  eq(result.review.totalOpen, 5);
  eq(result.receipts.grossReceived, 1200);
  eq(result.receipts.undeposited, 1200);
  eq(result.receipts.source, 'Cash Inflow ledger');
  eq(result.receipts.includedInBankTotals, false);
  eq(result.bank.postedNet, 325);
  notMatch(JSON.stringify(result), /fictional name|fictional-id/);
});

it('missing and stale business feeds cannot become zero', () => {
  const missing = data.summarizeBusiness({}, NOW);
  eq(missing.state, 'unknown');
  eq(missing.review.totalOpen, null);
  eq(missing.receipts.grossReceived, null);
  eq(missing.bank.postedNet, null);
  const old = ledger();
  old.generated_at = '2026-10-10T09:00:00Z';
  old.revision = 'DLW003-20261010T090000Z';
  const stale = data.summarizeReview(old, NOW);
  eq(stale.state, 'stale');
  eq(stale.totalOpen, 5);
});

it('edit-driven business obligations remain valid with an old source timestamp', () => {
  const old = business();
  old.updated_at = '2026-09-01T12:00:00Z';
  const result = data.summarizeBusinessCurrent(old, NOW);
  eq(result.state, 'live');
  eq(result.openDeadlines, 3);
  expect(result.sourceAgeMs! > 30 * 24 * 60 * 60_000).toBe(true);
  old.updated_at = '2026-10-11T12:00:00Z';
  eq(data.summarizeBusinessCurrent(old, NOW).state, 'unknown');
});

it('ledger review must reconcile and respect the privacy contract', () => {
  const badCount = ledger();
  badCount.review.total_open = 4;
  eq(data.summarizeReview(badCount, NOW).totalOpen, null);
  const badPrivacy = ledger();
  badPrivacy.privacy.identifiers = true;
  eq(data.summarizeReview(badPrivacy, NOW).state, 'unknown');
});

it('gross receipts require a valid, separate Cash Inflow ledger', () => {
  const badSource = receipts();
  badSource.included_in_bank_totals = true;
  eq(data.summarizeReceipts(badSource, NOW).grossReceived, null);
  const badPartition = receipts();
  badPartition.income.deposited = 1;
  eq(data.summarizeReceipts(badPartition, NOW).grossReceived, null);
  const old = receipts();
  old.generated_at = '2026-10-10T11:30:00Z';
  old.revision = 'LFA001-20261010T113000Z';
  eq(data.summarizeReceipts(old, NOW).state, 'stale');
});

it('bank activity can report real zero while unavailable bank stays unknown', () => {
  const disconnected = bank();
  disconnected.connection_status = 'reconnect_required';
  eq(data.summarizeBank(disconnected, NOW).postedNet, null);
  const zero = bank();
  zero.activity.month.money_in = '0.00';
  zero.activity.month.money_out = '0.00';
  zero.activity.month.net = '0.00';
  zero.activity.month.transaction_count = 0;
  eq(data.summarizeBank(zero, NOW).postedNet, 0);
  eq(data.summarizeBank(zero, NOW).state, 'live');
});

});
