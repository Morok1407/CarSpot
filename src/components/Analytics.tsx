import { useId, useMemo, useState, type ReactNode } from "react";
import type { CompletedVisit, ParkingSpot, SpotStatus } from "../api/parking";
import { buildAnalytics, type AnalyticsPeriod } from "../analytics";
import { shortVehicleLabels, statusLabels, vehicleTypes } from "../parking";
import { Icon, type IconName } from "./Icon";
import "./Analytics.css";

const amount = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
const money = (value: number) => `${amount(value)} ₸`;
const shortDate = (date: number) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(
    date,
  );
const colors = {
  available: "#2cba9a",
  occupied: "#2585f5",
  maintenance: "#efb652",
};
const statuses: SpotStatus[] = ["available", "occupied", "maintenance"];
const duration = (ms: number) => {
  const minutes = Math.round(ms / 60000);
  return minutes < 1
    ? "< 1 мин"
    : minutes < 60
      ? `${minutes} мин`
      : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
};

function CardHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="analytics-card-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function Ring({
  segments,
  center,
  caption,
  label,
}: {
  segments: { label: string; value: number; color: string }[];
  center: string;
  caption: string;
  label: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let offset = 0;
  return (
    <div className="analytics-ring">
      <svg viewBox="0 0 180 180" role="img" aria-label={label}>
        <circle
          cx="90"
          cy="90"
          r="71"
          fill="none"
          stroke="#edf2f9"
          strokeWidth="18"
        />
        {segments.map((segment) => {
          const size = total ? (segment.value / total) * 100 : 0;
          const start = offset;
          offset += size;
          return size > 0 ? (
            <circle
              key={segment.label}
              cx="90"
              cy="90"
              r="71"
              pathLength="100"
              fill="none"
              stroke={segment.color}
              strokeWidth="18"
              strokeDasharray={`${size} ${100 - size}`}
              strokeDashoffset={-start}
              transform="rotate(-90 90 90)"
            >
              <title>
                {segment.label}: {amount(segment.value)}
              </title>
            </circle>
          ) : null;
        })}
      </svg>
      <div className="analytics-ring-label" aria-hidden="true">
        <strong>{center}</strong>
        <span>{caption}</span>
      </div>
    </div>
  );
}

function PaymentsChart({ data }: { data: ReturnType<typeof buildAnalytics> }) {
  const gradient = useId().replace(/:/g, "");
  const [focused, setFocused] = useState<number | null>(null);
  const width = 760,
    height = 240,
    left = 62,
    right = 16,
    top = 24,
    bottom = 37;
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  const maxValue = Math.max(...data.daily.map((d) => d.amount), 1);
  const step = Math.max(1, 10 ** Math.floor(Math.log10(maxValue / 4)));
  const scale = Math.ceil(maxValue / (4 * step)) * 4 * step;
  const x = (i: number) => left + (i / (data.daily.length - 1)) * plotWidth;
  const y = (value: number) => top + plotHeight * (1 - value / scale);
  const line = data.daily
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.amount)}`)
    .join(" ");
  const index =
    focused !== null && focused < data.daily.length ? focused : null;
  const active = index === null ? null : data.daily[index];
  const ticks = [
    ...new Set(
      Array.from({ length: 7 }, (_, i) =>
        Math.round((i * (data.daily.length - 1)) / 6),
      ),
    ),
  ];
  return (
    <>
      <div className="chart-readout" aria-live="polite">
        {active ? (
          <>
            <span>{shortDate(active.timestamp)}</span>
            <strong>{money(active.amount)}</strong>
            <span>Оплат: {active.count}</span>
          </>
        ) : (
          <>
            <span>Сумма сохранённых оплат</span>
            <strong>{money(data.total)}</strong>
            <span>Наведите на график для деталей</span>
          </>
        )}
      </div>
      {data.paymentCount ? (
        <div className="timeline-wrap">
          <svg
            className="payment-timeline"
            viewBox={`0 0 ${width} ${height}`}
            aria-label="Сохранённые оплаты по дням, суммы в тенге. Числа также доступны в таблице под графиком."
            role="group"
          >
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2585f5" stopOpacity="0.17" />
                <stop offset="100%" stopColor="#2585f5" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3, 4].map((i) => {
              const value = (scale * i) / 4;
              return (
                <g key={i}>
                  <line
                    x1={left}
                    x2={width - right}
                    y1={y(value)}
                    y2={y(value)}
                    stroke="#edf1f7"
                    strokeDasharray="4 5"
                  />
                  <text x={left - 10} y={y(value) + 3} textAnchor="end">
                    {new Intl.NumberFormat("ru-RU", {
                      notation: value >= 100000 ? "compact" : "standard",
                      maximumFractionDigits: 1,
                    }).format(value)}
                  </text>
                </g>
              );
            })}
            <text x={left - 10} y="10" textAnchor="end">
              ₸
            </text>
            <path
              d={`${line} L${x(data.daily.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
              fill={`url(#${gradient})`}
            />
            <path
              d={line}
              fill="none"
              stroke="#2585f5"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {ticks.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={height - 10}
                textAnchor={
                  i === 0
                    ? "start"
                    : i === data.daily.length - 1
                      ? "end"
                      : "middle"
                }
              >
                {shortDate(data.daily[i].timestamp)}
              </text>
            ))}
            {index !== null && (
              <g>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={top}
                  y2={y(0)}
                  stroke="#a6cafa"
                  strokeDasharray="4 4"
                />
                <circle
                  cx={x(index)}
                  cy={y(data.daily[index].amount)}
                  r="4.5"
                  fill="#2585f5"
                  stroke="white"
                  strokeWidth="2"
                />
              </g>
            )}
            {data.daily.map((day, i) => (
              <rect
                key={day.key}
                className="chart-hit-target"
                x={Math.max(
                  left,
                  x(i) - plotWidth / (data.daily.length - 1) / 2,
                )}
                y={top - 6}
                width={plotWidth / (data.daily.length - 1)}
                height={plotHeight + 12}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${shortDate(day.timestamp)}: ${money(day.amount)}, оплат ${day.count}`}
                onMouseEnter={() => setFocused(i)}
                onMouseLeave={() => setFocused(null)}
                onFocus={() => setFocused(i)}
                onBlur={() => setFocused(null)}
              >
                <title>
                  {shortDate(day.timestamp)}: {money(day.amount)} · оплат{" "}
                  {day.count}
                </title>
              </rect>
            ))}
          </svg>
        </div>
      ) : (
        <div className="analytics-chart-empty">
          <Icon name="chart" size={32} />
          <h3>Нет сохранённых оплат за период</h3>
          <p>
            Здесь появятся суммы после отметки оплаты в карточке автомобиля.
          </p>
        </div>
      )}
      <details className="chart-data-table">
        <summary>Данные по дням</summary>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">
              Сохранённые оплаты за выбранный период
            </caption>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Количество оплат</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.key}>
                  <td>{shortDate(d.timestamp)}</td>
                  <td>{d.count}</td>
                  <td>{money(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export function Analytics({
  spots,
  history,
  updated,
  loading,
}: {
  spots: ParkingSpot[];
  history: CompletedVisit[];
  updated: number | null;
  loading: boolean;
}) {
  const [period, setPeriod] = useState<AnalyticsPeriod>(7);
  const data = useMemo(
    () => buildAnalytics(spots, period, updated ?? Date.now(), history),
    [spots, period, updated, history],
  );
  const metrics: {
    label: string;
    value: string;
    hint: string;
    icon: IconName;
  }[] = [
    {
      label: "Сохранённые оплаты",
      value: money(data.total),
      hint: "По дате отметки оплаты",
      icon: "chart",
    },
    {
      label: "Количество оплат",
      value: amount(data.paymentCount),
      hint: "В сохранённых визитах",
      icon: "check",
    },
    {
      label: "Средняя оплата",
      value: data.averagePayment === null ? "—" : money(data.averagePayment),
      hint: "По оплатам выбранного периода",
      icon: "list",
    },
    {
      label: "Средняя длительность",
      value:
        data.averageDurationMs === null
          ? "—"
          : duration(data.averageDurationMs),
      hint: `Завершённых визитов: ${data.completedCount}`,
      icon: "clock",
    },
  ];
  return (
    <div className="analytics-page" aria-busy={loading}>
      <div className="analytics-period-toolbar">
        <div>
          <h2>Показатели за период</h2>
          <p>
            {shortDate(data.start)} — {shortDate(data.asOf)} ·{" "}
            {new Date(data.asOf).getFullYear()}
          </p>
        </div>
        <div
          className="analytics-period"
          role="group"
          aria-label="Период аналитики"
        >
          {([7, 30, 90] as const).map((days) => (
            <button
              key={days}
              aria-pressed={period === days}
              className={period === days ? "active" : ""}
              onClick={() => setPeriod(days)}
            >
              {days} дней
            </button>
          ))}
        </div>
      </div>
      <div className="analytics-scope">
        <Icon name="info" size={18} />
        <p>
          <strong>История обслуженных автомобилей и текущие стоянки.</strong>{" "}
          Оплаты учитываются по дате платежа, завершённые визиты — по дате
          выезда. Удаление места не удаляет его историю.
        </p>
      </div>
      {updated === null ? (
        <section className="panel empty-state">
          {loading ? (
            <span className="loader" />
          ) : (
            <Icon name="chart" size={34} />
          )}
          <h3>{loading ? "Загружаем аналитику" : "Данные пока недоступны"}</h3>
          <p>Показатели появятся после успешного подключения к базе.</p>
        </section>
      ) : (
        <>
          <div className="analytics-metrics">
            {metrics.map((m) => (
              <article className="stat-card" key={m.label}>
                <div className="stat-top">
                  <span>{m.label}</span>
                  <span className="stat-icon">
                    <Icon name={m.icon} size={18} />
                  </span>
                </div>
                <strong className="stat-number">{m.value}</strong>
                <small>{m.hint}</small>
              </article>
            ))}
          </div>
          <div className="analytics-charts-top">
            <section className="panel">
              <CardHeading
                title="Динамика оплат"
                subtitle="Сохранённые оплаты по дням"
              >
                <span className="analytics-unit">ТЕНГЕ</span>
              </CardHeading>
              <PaymentsChart key={period} data={data} />
            </section>
            <section className="panel payment-method-chart">
              <CardHeading
                title="Способы оплаты"
                subtitle="Доли от суммы за выбранный период"
              />
              <Ring
                label={`Наличные: ${money(data.methods.cash.amount)}. Карта: ${money(data.methods.card.amount)}. Смешанная: ${money(data.methods.mixed.amount)}.`}
                segments={[
                  {
                    label: "Наличные",
                    value: data.methods.cash.amount,
                    color: "#2585f5",
                  },
                  {
                    label: "Карта",
                    value: data.methods.card.amount,
                    color: "#96bafa",
                  },
                  {
                    label: "Смешанная",
                    value: data.methods.mixed.amount,
                    color: "#8c7fe0",
                  },
                ]}
                center={amount(data.paymentCount)}
                caption="оплат"
              />
              <div className="analytics-method-legend">
                {(["cash", "card", "mixed"] as const).map((method) => (
                  <div key={method}>
                    <span>
                      <i
                        style={{
                          background:
                            method === "mixed"
                              ? "#8c7fe0"
                              : method === "cash"
                                ? "#2585f5"
                                : "#96bafa",
                        }}
                      />
                      {method === "mixed"
                        ? "Смешанная"
                        : method === "cash"
                          ? "Наличные"
                          : "Карта"}
                      <small>{data.methods[method].count} оплат</small>
                    </span>
                    <strong>
                      {money(data.methods[method].amount)}
                      <small>
                        {data.total
                          ? Math.round(
                              (data.methods[method].amount / data.total) * 100,
                            )
                          : 0}
                        %
                      </small>
                    </strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <div className="analytics-section-label">
            <div>
              <h2>Парковка сейчас</h2>
              <p>Текущий снимок · не зависит от выбранного периода</p>
            </div>
            <span>{spots.length} мест</span>
          </div>
          <div className="analytics-charts-bottom">
            <section className="panel">
              <CardHeading
                title="Загрузка парковки"
                subtitle="Занятые, свободные и обслуживаемые места"
              />
              <div className="analytics-occupancy">
                <Ring
                  label={statuses
                    .map((s) => `${statusLabels[s]}: ${data.status[s]}`)
                    .join(". ")}
                  segments={statuses.map((s) => ({
                    label: statusLabels[s],
                    value: data.status[s],
                    color: colors[s],
                  }))}
                  center={
                    data.occupancy === null
                      ? "—"
                      : `${Math.round(data.occupancy)}%`
                  }
                  caption="занято"
                />
                <div className="occupancy-legend">
                  {statuses.map((s) => (
                    <div key={s}>
                      <span>
                        <i style={{ background: colors[s] }} />
                        {statusLabels[s]}
                      </span>
                      <strong>{data.status[s]}</strong>
                    </div>
                  ))}
                  <p>Из общей вместимости {spots.length} мест</p>
                </div>
              </div>
            </section>
            <section className="panel">
              <CardHeading
                title="Места по типу транспорта"
                subtitle="Количество мест и их текущее состояние"
              />
              <div className="analytics-vehicles">
                {vehicleTypes.map((type) => {
                  const total = statuses.reduce(
                    (sum, status) => sum + data.vehicles[type][status],
                    0,
                  );
                  const max = Math.max(
                    ...vehicleTypes.map((t) =>
                      statuses.reduce((sum, s) => sum + data.vehicles[t][s], 0),
                    ),
                    1,
                  );
                  return (
                    <div className="analytics-vehicle" key={type}>
                      <div>
                        <span>
                          <Icon name={type} size={18} />
                          {shortVehicleLabels[type]}
                        </span>
                        <strong>{total}</strong>
                      </div>
                      <div
                        className="analytics-bar-track"
                        role="img"
                        aria-label={`${shortVehicleLabels[type]}: ${statuses.map((s) => `${statusLabels[s]} ${data.vehicles[type][s]}`).join(", ")}`}
                      >
                        {statuses.map((s) => (
                          <span
                            key={s}
                            style={{
                              width: `${(data.vehicles[type][s] / max) * 100}%`,
                              background: colors[s],
                            }}
                            title={`${statusLabels[s]}: ${data.vehicles[type][s]}`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="legend">
                  {statuses.map((s) => (
                    <span key={s}>
                      <i style={{ background: colors[s] }} />
                      {statusLabels[s]}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </div>
          <div className="analytics-footnote">
            <Icon name="clock" size={14} />
            <span>
              Снимок: {new Date(updated).toLocaleString("ru-RU")} ·{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}. Дни считаются
              по местному времени. Длительность — по дате завершения визита.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
