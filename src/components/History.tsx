import { useState } from "react";
import type { CompletedVisit } from "../api/parking";
import { dateTime, vehicleLabels } from "../parking";

const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;
export function History({
  records,
  query,
  loading,
}: {
  records: CompletedVisit[];
  query: string;
  loading: boolean;
}) {
  const [page, setPage] = useState(0);
  const filtered = records
    .filter((r) =>
      `${r.spot_number} ${r.visit.license_plate}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => (b.visit.exited_at_ms ?? 0) - (a.visit.exited_at_ms ?? 0));
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const current = Math.min(page, pages - 1);
  return (
    <section className="panel history-panel" aria-busy={loading}>
      <div className="history-heading">
        <div>
          <h2>Обслуженные автомобили</h2>
          <p className="muted">
            История завершённых стоянок · Найдено: {filtered.length}
          </p>
        </div>
      </div>
      <div className="history-scroll">
        <table className="history-table">
          <thead>
            <tr>
              <th>Автомобиль</th>
              <th>Место</th>
              <th>Въезд</th>
              <th>Выезд</th>
              <th>Тариф</th>
              <th>Оплата</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(current * 25, current * 25 + 25).map((r) => (
              <tr key={r._id}>
                <td>
                  <strong>{r.visit.license_plate}</strong>
                  <small>{vehicleLabels[r.vehicle_type]}</small>
                </td>
                <td>{r.spot_number}</td>
                <td>{dateTime(r.visit.entry_at_ms)}</td>
                <td>
                  {r.visit.exited_at_ms === null
                    ? "—"
                    : dateTime(r.visit.exited_at_ms)}
                </td>
                <td>
                  {r.visit.tariff_mode === "open" ? "Открытый" : "По времени"}
                  <small>{money(r.visit.hourly_rate)} / час</small>
                </td>
                <td>
                  {r.visit.payment ? (
                    <>
                      <strong>{money(r.visit.payment.amount)}</strong>
                      <small>
                        {r.visit.payment.method === "mixed"
                          ? `Наличные: ${money(r.visit.payment.cash_amount ?? Math.floor(r.visit.payment.amount / 2))} · Карта: ${money(r.visit.payment.card_amount ?? Math.ceil(r.visit.payment.amount / 2))}`
                          : r.visit.payment.method === "cash"
                            ? "Наличные"
                            : "Карта"}
                      </small>
                    </>
                  ) : (
                    "Нет оплаты"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <h3>
            {loading ? "Загружаем историю…" : "Завершённых стоянок не найдено"}
          </h3>
          <p>
            После оформления выезда автомобиль появится здесь. Поиск — по
            госномеру или месту.
          </p>
        </div>
      )}
      {pages > 1 && (
        <div className="history-pagination">
          <button
            className="button secondary"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Назад
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            className="button secondary"
            disabled={current + 1 === pages}
            onClick={() => setPage(current + 1)}
          >
            Далее
          </button>
        </div>
      )}
    </section>
  );
}
