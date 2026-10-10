import type {
  ParkingSpot,
  SpotStatus,
  VehicleType,
  Visit,
  CompletedVisit,
} from "./api/parking";

export type AnalyticsPeriod = 7 | 30 | 90;
export type StatusCounts = Record<SpotStatus, number>;
export function dayKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Current occupancy is a snapshot; period totals combine completed history and current visits. */
export function buildAnalytics(
  spots: ParkingSpot[],
  days: AnalyticsPeriod,
  asOf: number,
  history: CompletedVisit[] = [],
) {
  const start = new Date(asOf);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return {
      key: dayKey(date.getTime()),
      timestamp: date.getTime(),
      amount: 0,
      count: 0,
    };
  });
  const byDay = new Map(daily.map((day) => [day.key, day]));
  const status: StatusCounts = { available: 0, occupied: 0, maintenance: 0 };
  const vehicles: Record<VehicleType, StatusCounts> = {
    car: { ...status },
    motorcycle: { ...status },
    truck: { ...status },
  };
  const retained = new Map<string, Visit>();
  for (const spot of spots) {
    status[spot.status]++;
    vehicles[spot.vehicle_type][spot.status]++;
    for (const visit of [spot.active_visit]) {
      if (visit) retained.set(visit.id, visit);
    }
  }
  for (const record of history) retained.set(record.visit.id, record.visit);
  const inPeriod = (date: number) => date >= start.getTime() && date <= asOf;
  const payments = [...retained.values()].flatMap((visit) =>
    visit.payment && inPeriod(visit.payment.paid_at_ms) ? [visit.payment] : [],
  );
  const methods = {
    cash: { amount: 0, count: 0 },
    card: { amount: 0, count: 0 },
    mixed: { amount: 0, count: 0 },
  };
  for (const payment of payments) {
    const day = byDay.get(dayKey(payment.paid_at_ms))!;
    day.amount += payment.amount;
    day.count++;
    methods[payment.method].amount += payment.amount;
    methods[payment.method].count++;
  }
  const completed = [...retained.values()].filter(
    (v) =>
      v.exited_at_ms !== null &&
      inPeriod(v.exited_at_ms) &&
      v.exited_at_ms > v.entry_at_ms,
  );
  const total = payments.reduce((sum, p) => sum + p.amount, 0);
  return {
    start: start.getTime(),
    asOf,
    daily,
    status,
    vehicles,
    methods,
    total,
    paymentCount: payments.length,
    averagePayment: payments.length ? total / payments.length : null,
    averageDurationMs: completed.length
      ? completed.reduce((sum, v) => sum + v.exited_at_ms! - v.entry_at_ms, 0) /
        completed.length
      : null,
    completedCount: completed.length,
    retainedCount: retained.size,
    occupancy: spots.length ? (status.occupied / spots.length) * 100 : null,
  };
}
