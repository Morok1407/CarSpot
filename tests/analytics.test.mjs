import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnalytics, dayKey } from "../src/analytics.ts";
const now = new Date(2026, 9, 10, 12).getTime();
const start = new Date(2026, 9, 4).getTime();
const visit = (id, paidAt, method = "cash", amount = 500) => ({
  id,
  license_plate: "TEST",
  entry_at_ms: paidAt - 3600000,
  planned_exit_at_ms: null,
  tariff_mode: "open",
  hourly_rate: 500,
  exited_at_ms: paidAt,
  payment: { paid_at_ms: paidAt, departure_at_ms: paidAt, amount, method },
});
const record = (v) => ({
  _id: v.id,
  spot_id: "deleted-spot",
  spot_number: "A-001",
  vehicle_type: "car",
  visit: v,
});
const spot = (active_visit = null) => ({
  id: "1",
  number: "A-001",
  status: "occupied",
  vehicle_type: "car",
  active_visit,
  license_plate: "TEST",
  created_at_ms: now,
  updated_at_ms: now,
});
test("empty database has no fabricated metrics", () => {
  const data = buildAnalytics([], 7, now, []);
  assert.equal(data.occupancy, null);
  assert.equal(data.averagePayment, null);
  assert.equal(data.averageDurationMs, null);
  assert.equal(data.total, 0);
  assert.equal(data.daily.length, 7);
});
test("history survives missing spots and respects payment date boundaries", () => {
  const history = [
    visit("a", start),
    visit("b", now, "card", 1500),
    visit("c", start - 1),
    visit("d", now + 1),
  ].map(record);
  const data = buildAnalytics([], 7, now, history);
  assert.equal(data.total, 2000);
  assert.equal(data.paymentCount, 2);
  assert.equal(data.daily[0].key, dayKey(start));
  assert.equal(data.daily[0].amount, 500);
  assert.equal(data.daily[6].amount, 1500);
  assert.equal(data.occupancy, null);
});
test("all successive visits of one spot remain counted", () => {
  const history = [visit("a", now - 3600000), visit("b", now)].map(record);
  const data = buildAnalytics([spot()], 7, now, history);
  assert.equal(data.paymentCount, 2);
  assert.equal(data.completedCount, 2);
  assert.equal(data.total, 1000);
  assert.equal(data.status.occupied, 1);
});
test("archived snapshot wins over active snapshot in checkout overlap", () => {
  const completed = visit("same", now);
  const active = { ...completed, exited_at_ms: null };
  const data = buildAnalytics([spot(active)], 7, now, [record(completed)]);
  assert.equal(data.paymentCount, 1);
  assert.equal(data.completedCount, 1);
  assert.equal(data.retainedCount, 1);
});
test("mixed payment counts once with arbitrary cash/card split", () => {
  const mixed = visit("mixed", now, "mixed", 501);
  mixed.payment.cash_amount = 100;
  mixed.payment.card_amount = 401;
  const data = buildAnalytics([], 7, now, [record(mixed)]);
  assert.equal(data.total, 501);
  assert.deepEqual(data.methods.mixed, { amount: 501, count: 1 });
  assert.equal(data.methods.cash.amount + data.methods.card.amount, 0);
});
test("payment dates and completion dates are independent", () => {
  const earlier = visit("earlier", start - 1);
  earlier.entry_at_ms = start - 7200000;
  earlier.exited_at_ms = start;
  const active = { ...visit("active", now), exited_at_ms: null };
  const data = buildAnalytics([spot(active)], 7, now, [record(earlier)]);
  assert.equal(data.paymentCount, 1);
  assert.equal(data.completedCount, 1);
  assert.equal(data.averageDurationMs, 7200000);
});
test("period changes historical totals but not occupancy", () => {
  const history = [record(visit("old", new Date(2026, 8, 20, 12).getTime()))];
  const week = buildAnalytics([spot()], 7, now, history);
  const month = buildAnalytics([spot()], 30, now, history);
  assert.equal(week.total, 0);
  assert.equal(month.total, 500);
  assert.equal(month.daily.length, 30);
  assert.deepEqual(week.status, month.status);
  assert.equal(week.occupancy, 100);
});
