import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  parkingApi,
  type ParkingSpot,
  type SpotStatus,
  type VehicleType,
} from "./api/parking";
import { Icon, type IconName } from "./components/Icon";
import { ConfirmDialog, SpotForm, type FormMode } from "./components/SpotForm";
import {
  dateTime,
  errorMessage,
  shortVehicleLabels,
  spotInput,
  statusLabels,
  vehicleLabels,
  vehicleTypes,
} from "./parking";
import "./App.css";

type Page = "overview" | "map" | "list";
const pages: { id: Page; title: string; icon: IconName }[] = [
  { id: "overview", title: "Обзор", icon: "grid" },
  { id: "map", title: "Схема парковки", icon: "map" },
  { id: "list", title: "Все места", icon: "list" },
];
function Badge({ status }: { status: SpotStatus }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {statusLabels[status]}
    </span>
  );
}

function App() {
  const [page, setPage] = useState<Page>("map");
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SpotStatus | "all">("all");
  const [type, setType] = useState<VehicleType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updated, setUpdated] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<{
    mode: FormMode;
    spot?: ParkingSpot;
  } | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "release" | "seed" | null>(
    null,
  );
  const [help, setHelp] = useState(false);
  const generation = useRef(0);
  const selected = spots.find((s) => s.id === selectedId);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setLoadError("");
    try {
      if (!isTauri())
        throw new Error(
          "Откройте CarSpot как десктоп-приложение: npm run tauri dev. Подключение к базе доступно в окне Tauri.",
        );
      const all: ParkingSpot[] = [];
      let batch: ParkingSpot[];
      do {
        batch = await parkingApi.list(null, all.length, 200);
        all.push(...batch);
      } while (batch.length === 200);
      if (request !== generation.current) return;
      setSpots(all);
      setUpdated(Date.now());
      setSelectedId((previous) =>
        all.some((s) => s.id === previous) ? previous : null,
      );
    } catch (e) {
      if (request === generation.current) setLoadError(errorMessage(e));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const counts = {
    available: spots.filter((s) => s.status === "available").length,
    occupied: spots.filter((s) => s.status === "occupied").length,
    maintenance: spots.filter((s) => s.status === "maintenance").length,
  };
  const percent = spots.length
    ? Math.round((counts.occupied / spots.length) * 100)
    : 0;
  const search = query.trim().toLocaleUpperCase();
  const filtered = spots.filter(
    (s) =>
      (status === "all" || s.status === status) &&
      (type === "all" || s.vehicle_type === type) &&
      (!search ||
        s.number.toLocaleUpperCase().includes(search) ||
        s.license_plate?.toLocaleUpperCase().includes(search)),
  );
  const hasFilters = query !== "" || status !== "all" || type !== "all";
  const unavailable = loading || !!loadError;
  function clearFilters() {
    setQuery("");
    setStatus("all");
    setType("all");
  }
  function upsert(spot: ParkingSpot) {
    setSpots((old) =>
      [...old.filter((s) => s.id !== spot.id), spot].sort((a, b) =>
        a.number.localeCompare(b.number),
      ),
    );
    setSelectedId(spot.id);
    setUpdated(Date.now());
  }
  function table(rows: ParkingSpot[]) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Парковочное место</th>
              <th>Состояние</th>
              <th>Тип транспорта</th>
              <th>Госномер</th>
              <th>Обновлено</th>
              <th>
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.id}
                className={selectedId === s.id ? "selected-row" : ""}
              >
                <td>
                  <button
                    className="spot-link"
                    onClick={() => setSelectedId(s.id)}
                  >
                    <span className={`mini-parking ${s.status}`}>P</span>
                    {s.number}
                  </button>
                </td>
                <td>
                  <Badge status={s.status} />
                </td>
                <td>{vehicleLabels[s.vehicle_type]}</td>
                <td>
                  {s.license_plate ? (
                    <span className="plate-inline">{s.license_plate}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="date-cell">{dateTime(s.updated_at_ms)}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Открыть место ${s.number}`}
                    onClick={() => setSelectedId(s.id)}
                  >
                    <Icon name="chevron" size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
        >
          <span className="brand-mark">
            P<span />
          </span>
          <span>
            Car<span className="brand-light">Spot</span>
            <small>УПРАВЛЕНИЕ ПАРКОВКОЙ</small>
          </span>
        </a>
        <div className="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav aria-label="Основное меню">
          {pages.map((p) => (
            <button
              key={p.id}
              className={`nav-item ${page === p.id ? "active" : ""}`}
              aria-current={page === p.id ? "page" : undefined}
              onClick={() => {
                setPage(p.id);
                clearFilters();
              }}
            >
              <Icon name={p.icon} />
              {p.title}
              {p.id === "list" && (
                <span className="nav-count">
                  {updated ? spots.length : "—"}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-card">
            <span className="workspace-icon">
              <Icon name="map" />
            </span>
            <div>
              <strong>Основная парковка</strong>
              <small>Локальное управление</small>
            </div>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <Icon name="info" size={18} />
            Помощь оператору
            <Icon name="chevron" size={15} />
          </button>
          <span className="version">
            CARSPOT <span>Версия 0.1.0</span>
          </span>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="global-search">
            <Icon name="search" />
            <input
              aria-label="Поиск по номеру места или госномеру"
              placeholder="Поиск по номеру места или автомобиля"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (page === "overview") setPage("list");
              }}
            />
            {query && (
              <button
                aria-label="Очистить поиск"
                className="icon-button"
                onClick={() => setQuery("")}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
          <div className="topbar-right">
            <span
              className={`connection ${loadError ? "offline" : loading ? "pending" : ""}`}
            >
              <i />
              {loadError
                ? "Нет подключения"
                : loading
                  ? "Подключение…"
                  : "База подключена"}
            </span>
            <span className="top-divider" />
            <div className="operator-avatar">
              ОП
              <span />
            </div>
            <div className="operator">
              <strong>Оператор</strong>
              <small>Рабочее место</small>
            </div>
          </div>
        </header>
        <div className={`workspace ${selected ? "with-details" : ""}`}>
          <main className="main-content">
            <div className="breadcrumb">
              Основная парковка <span>/</span>{" "}
              {pages.find((p) => p.id === page)?.title}
            </div>
            <div className="page-heading">
              <div>
                <h1>
                  {page === "map"
                    ? "Схема парковки"
                    : page === "overview"
                      ? "Обзор парковки"
                      : "Парковочные места"}
                </h1>
                <p>
                  {page === "map"
                    ? "Каждое место под контролем"
                    : page === "overview"
                      ? "Всё, что нужно знать о парковке сейчас"
                      : "Управление местами и припаркованными автомобилями"}
                </p>
              </div>
              <button
                disabled={unavailable}
                className="button primary"
                onClick={() => setForm({ mode: "create" })}
              >
                <Icon name="plus" size={18} />
                Добавить место
              </button>
            </div>
            {loadError && (
              <div className="error-banner" role="alert">
                <Icon name="info" />
                <div>
                  <strong>Не удалось обновить данные</strong>
                  <p>{loadError}</p>
                  {updated && (
                    <small>
                      Показаны данные последнего успешного обновления.
                    </small>
                  )}
                </div>
                <button
                  disabled={loading}
                  className="button secondary"
                  onClick={() => void refresh()}
                >
                  Повторить
                </button>
              </div>
            )}
            <div className="stats-grid">
              {(
                [
                  [
                    "Всего мест",
                    updated ? spots.length : "—",
                    "map",
                    "total",
                    "Вместимость парковки",
                  ],
                  [
                    "Свободно",
                    updated ? counts.available : "—",
                    "check",
                    "available",
                    "Доступны для автомобилей",
                  ],
                  [
                    "Занято",
                    updated ? counts.occupied : "—",
                    "car",
                    "occupied",
                    "Автомобили на парковке",
                  ],
                  [
                    "Обслуживание",
                    updated ? counts.maintenance : "—",
                    "wrench",
                    "maintenance",
                    "Временно недоступны",
                  ],
                ] as const
              ).map(([label, value, icon, color, caption]) => (
                <div className={`stat-card ${color}`} key={label}>
                  <div className="stat-top">
                    <span>{label}</span>
                    <span className="stat-icon">
                      <Icon name={icon} size={18} />
                    </span>
                  </div>
                  <strong className="stat-number">{value}</strong>
                  <small>{caption}</small>
                </div>
              ))}
            </div>
            {page === "overview" ? (
              <>
                <div className="overview-grid">
                  <section className="panel occupancy">
                    <div className="section-heading">
                      <h2>Загрузка парковки</h2>
                      <span className="eyebrow">СЕЙЧАС</span>
                    </div>
                    <div className="occupancy-body">
                      <div
                        className="donut"
                        style={{
                          background: `conic-gradient(var(--blue) ${percent}%, #edf1f8 0)`,
                        }}
                      >
                        <div>
                          <strong>
                            {updated ? percent : "—"}
                            <small>%</small>
                          </strong>
                          <span>занято</span>
                        </div>
                      </div>
                      <div className="occupancy-copy">
                        <h3>
                          {!updated
                            ? "Ожидаем данные"
                            : counts.available
                              ? "Есть свободные места"
                              : "Свободных мест нет"}
                        </h3>
                        <p>
                          {updated
                            ? `${counts.available} из ${spots.length} мест доступны для размещения транспорта.`
                            : "Сведения появятся после подключения к базе."}
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setPage("map")}
                        >
                          Открыть схему
                          <Icon name="arrow" size={17} />
                        </button>
                      </div>
                    </div>
                  </section>
                  <section className="panel vehicle-summary">
                    <div className="section-heading">
                      <h2>По типу транспорта</h2>
                    </div>
                    {vehicleTypes.map((t) => {
                      const group = spots.filter((s) => s.vehicle_type === t);
                      const free = group.filter(
                        (s) => s.status === "available",
                      ).length;
                      return (
                        <div className="vehicle-summary-row" key={t}>
                          <span className="vehicle-symbol">
                            <Icon name={t} />
                          </span>
                          <div>
                            <strong>{shortVehicleLabels[t]}</strong>
                            <small>
                              {updated
                                ? `${free} свободно из ${group.length}`
                                : "Нет данных"}
                            </small>
                          </div>
                          <div className="small-progress">
                            <span
                              style={{
                                width: `${group.length ? (free / group.length) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </section>
                </div>
                <section className="panel recent">
                  <div className="section-heading">
                    <h2>
                      <Icon name="clock" />
                      Недавно обновлённые места
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setPage("list")}
                    >
                      Все места
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  {spots.length ? (
                    table(
                      [...spots]
                        .sort((a, b) => b.updated_at_ms - a.updated_at_ms)
                        .slice(0, 6),
                    )
                  ) : (
                    <div className="empty-state">
                      <Icon name="map" size={34} />
                      <h3>
                        {loading ? "Загружаем парковку…" : "Пока нет мест"}
                      </h3>
                      <p>
                        Добавьте первое место или заполните парковку на вкладке
                        «Все места».
                      </p>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <section className="panel parking-panel" aria-busy={loading}>
                <div className="parking-toolbar">
                  <div className="view-switch" aria-label="Вид парковки">
                    <button
                      className={page === "map" ? "active" : ""}
                      onClick={() => setPage("map")}
                    >
                      <Icon name="map" size={17} />
                      Схема
                    </button>
                    <button
                      className={page === "list" ? "active" : ""}
                      onClick={() => setPage("list")}
                    >
                      <Icon name="list" size={17} />
                      Список
                    </button>
                  </div>
                  <div className="filters">
                    <select
                      aria-label="Фильтр по состоянию"
                      value={status}
                      onChange={(e) =>
                        setStatus(e.target.value as SpotStatus | "all")
                      }
                    >
                      <option value="all">Все состояния</option>
                      {Object.entries(statusLabels).map(([s, label]) => (
                        <option value={s} key={s}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Фильтр по транспорту"
                      value={type}
                      onChange={(e) =>
                        setType(e.target.value as VehicleType | "all")
                      }
                    >
                      <option value="all">Весь транспорт</option>
                      {vehicleTypes.map((t) => (
                        <option value={t} key={t}>
                          {shortVehicleLabels[t]}
                        </option>
                      ))}
                    </select>
                    <button
                      className={`icon-button refresh ${loading ? "spinning" : ""}`}
                      aria-label="Обновить данные"
                      disabled={loading || !!form || !!confirm}
                      onClick={() => void refresh()}
                    >
                      <Icon name="refresh" size={18} />
                    </button>
                  </div>
                </div>
                <div className="map-meta">
                  <span>
                    {loading
                      ? "Обновление…"
                      : `Показано ${filtered.length} из ${spots.length} мест`}
                    {hasFilters && (
                      <button className="text-button" onClick={clearFilters}>
                        Сбросить фильтры
                      </button>
                    )}
                  </span>
                  <div className="legend">
                    <span>
                      <i className="available" />
                      Свободно
                    </span>
                    <span>
                      <i className="occupied" />
                      Занято
                    </span>
                    <span>
                      <i className="maintenance" />
                      Обслуживание
                    </span>
                  </div>
                </div>
                {loading && !updated ? (
                  <div className="empty-state">
                    <span className="loader" />
                    <h3>Загружаем парковку</h3>
                    <p>Получаем актуальные данные о местах…</p>
                  </div>
                ) : !filtered.length ? (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <Icon name={hasFilters ? "search" : "map"} size={30} />
                    </div>
                    <h3>
                      {loadError && !updated
                        ? "Парковка пока недоступна"
                        : hasFilters
                          ? "Места не найдены"
                          : "Создайте свою парковку"}
                    </h3>
                    <p>
                      {hasFilters
                        ? "Попробуйте изменить поиск или сбросить фильтры."
                        : loadError
                          ? "Проверьте подключение и попробуйте обновить данные."
                          : "Добавьте место вручную или создайте стандартный набор из 50 мест."}
                    </p>
                    {hasFilters ? (
                      <button
                        className="button secondary"
                        onClick={clearFilters}
                      >
                        Сбросить фильтры
                      </button>
                    ) : (
                      !loadError && (
                        <button
                          className="button primary"
                          onClick={() => setConfirm("seed")}
                        >
                          <Icon name="plus" size={17} />
                          Создать 50 мест
                        </button>
                      )
                    )}
                  </div>
                ) : page === "list" ? (
                  table(filtered)
                ) : (
                  <div className="parking-map">
                    <div className="map-entrance">
                      <span>
                        <Icon name="arrow" size={16} />
                        ВЪЕЗД
                      </span>
                      <div />
                      <span className="office">
                        <Icon name="grid" size={15} />
                        ПОСТ ОПЕРАТОРА
                      </span>
                    </div>
                    {vehicleTypes.map((t) => {
                      const group = filtered.filter(
                        (s) => s.vehicle_type === t,
                      );
                      if (!group.length) return null;
                      const rows = Array.from(
                        { length: Math.ceil(group.length / 10) },
                        (_, i) => group.slice(i * 10, i * 10 + 10),
                      );
                      return (
                        <section className={`parking-zone zone-${t}`} key={t}>
                          <div className="zone-heading">
                            <span className="zone-name">
                              <Icon name={t} size={18} />
                              {shortVehicleLabels[t]}
                            </span>
                            <span>
                              {group.length} мест
                              <span className="zone-dot">·</span>
                              {
                                group.filter((s) => s.status === "available")
                                  .length
                              }{" "}
                              свободно
                            </span>
                          </div>
                          {rows.map((row, i) => (
                            <div key={i} className="parking-row-group">
                              <div className="parking-row">
                                {row.map((s) => (
                                  <button
                                    key={s.id}
                                    aria-pressed={selectedId === s.id}
                                    aria-label={`${s.number}: ${statusLabels[s.status]}${s.license_plate ? `, ${s.license_plate}` : ""}`}
                                    onClick={() => setSelectedId(s.id)}
                                    className={`parking-spot ${s.status} ${selectedId === s.id ? "selected" : ""}`}
                                  >
                                    <span className="spot-number">
                                      {s.number}
                                    </span>
                                    <Icon
                                      name={
                                        s.status === "maintenance"
                                          ? "wrench"
                                          : s.vehicle_type
                                      }
                                      size={28}
                                    />
                                    <span className="spot-caption">
                                      {s.status === "occupied"
                                        ? s.license_plate
                                        : s.status === "maintenance"
                                          ? "Сервис"
                                          : "Свободно"}
                                    </span>
                                    {selectedId === s.id && (
                                      <span className="selected-check">
                                        <Icon name="check" size={10} />
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                              {i < rows.length - 1 && i % 2 === 0 && (
                                <div className="drive-lane">
                                  <span>→</span>
                                  <span>ПРОЕЗД</span>
                                  <span>→</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </section>
                      );
                    })}
                    <div className="map-exit">
                      <span />
                      <span>
                        ВЫЕЗД
                        <Icon name="arrow" size={16} />
                      </span>
                    </div>
                    <p className="map-note">
                      <Icon name="info" size={14} />
                      Схематичное расположение. Нажмите на место, чтобы
                      посмотреть детали.
                    </p>
                  </div>
                )}
                <div className="panel-footer">
                  <span>
                    <Icon name="clock" size={14} />
                    {updated
                      ? `Обновлено в ${new Date(updated).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
                      : "Ожидание подключения"}
                  </span>
                  <span>Основная парковка</span>
                </div>
              </section>
            )}
            <footer className="main-footer">
              <span>CarSpot · Рабочее пространство оператора</span>
              <span>
                {new Date().toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </footer>
          </main>
          {selected && (
            <aside
              className="details-panel"
              aria-label={`Детали места ${selected.number}`}
            >
              <div className="detail-top">
                <span>Парковочное место</span>
                <button
                  className="icon-button"
                  aria-label="Закрыть детали"
                  onClick={() => setSelectedId(null)}
                >
                  <Icon name="close" size={19} />
                </button>
              </div>
              <div className={`detail-hero ${selected.status}`}>
                <span className="hero-grid" />
                <div className="hero-parking-letter">P</div>
                <Icon name={selected.vehicle_type} size={100} />
                <span className="hero-number">{selected.number}</span>
              </div>
              <div className="detail-content">
                <div className="detail-title">
                  <div>
                    <span className="eyebrow">ПАРКОВОЧНОЕ МЕСТО</span>
                    <h2>{selected.number}</h2>
                  </div>
                  <Badge status={selected.status} />
                </div>
                <p className="detail-subtitle">
                  {vehicleLabels[selected.vehicle_type]}
                </p>
                <div className="plate-card">
                  <span className="eyebrow">ГОСУДАРСТВЕННЫЙ НОМЕР</span>
                  {selected.license_plate ? (
                    <div className="license-plate">
                      {selected.license_plate}
                    </div>
                  ) : (
                    <div className="no-vehicle">
                      <Icon
                        name={
                          selected.status === "maintenance" ? "wrench" : "car"
                        }
                      />
                      <span>
                        {selected.status === "maintenance"
                          ? "Место на обслуживании"
                          : "Автомобиль не размещён"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="detail-section">
                  <h3>
                    <Icon name="info" size={17} />
                    Информация о месте
                  </h3>
                  <dl>
                    <div>
                      <dt>Тип транспорта</dt>
                      <dd>{vehicleLabels[selected.vehicle_type]}</dd>
                    </div>
                    <div>
                      <dt>Создано</dt>
                      <dd>{dateTime(selected.created_at_ms)}</dd>
                    </div>
                    <div>
                      <dt>Обновлено</dt>
                      <dd>{dateTime(selected.updated_at_ms)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="detail-actions">
                  {selected.status === "available" && (
                    <button
                      disabled={unavailable}
                      className="button primary"
                      onClick={() =>
                        setForm({ mode: "occupy", spot: selected })
                      }
                    >
                      <Icon name="car" size={18} />
                      Занять место
                    </button>
                  )}
                  {selected.status === "occupied" && (
                    <button
                      disabled={unavailable}
                      className="button primary"
                      onClick={() => setConfirm("release")}
                    >
                      <Icon name="exit" size={18} />
                      Освободить место
                    </button>
                  )}
                  <button
                    disabled={unavailable}
                    className="button secondary"
                    onClick={() => setForm({ mode: "edit", spot: selected })}
                  >
                    <Icon name="edit" size={17} />
                    Редактировать
                  </button>
                  <button
                    disabled={unavailable || selected.status === "occupied"}
                    className="delete-button"
                    onClick={() => setConfirm("delete")}
                  >
                    <Icon name="trash" size={16} />
                    Удалить место
                  </button>
                  {selected.status === "occupied" && (
                    <p className="detail-hint">
                      Для удаления сначала освободите место.
                    </p>
                  )}
                </div>
                <div className="detail-tip">
                  <Icon name="info" size={17} />
                  <p>
                    Изменения сохраняются в базе данных сразу после
                    подтверждения.
                  </p>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
      {notice && (
        <div className="toast" role="status">
          <span>
            <Icon name="check" size={18} />
          </span>
          {notice}
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setNotice("")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {form && (
        <SpotForm
          mode={form.mode}
          spot={form.spot}
          onClose={() => setForm(null)}
          onSave={async (input) => {
            const result = form.spot
              ? await parkingApi.update(form.spot.id, input)
              : await parkingApi.create(input);
            upsert(result);
            setNotice(
              form.mode === "create"
                ? `Место ${result.number} создано`
                : `Место ${result.number} обновлено`,
            );
          }}
        />
      )}
      {confirm === "seed" && (
        <ConfirmDialog
          title="Создать стандартную парковку?"
          description="Будут добавлены 40 мест для легковых автомобилей, 5 для мотоциклов и 5 для грузовиков. Существующие места не изменятся."
          action="Создать места"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const count = await parkingApi.seed();
            await refresh();
            setNotice(`Добавлено мест: ${count}`);
          }}
        />
      )}
      {confirm === "delete" && selected && (
        <ConfirmDialog
          title={`Удалить место ${selected.number}?`}
          description="Место будет удалено из базы данных. Это действие нельзя отменить."
          action="Удалить место"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await parkingApi.delete(selected.id);
            setSpots((old) => old.filter((s) => s.id !== selected.id));
            setSelectedId(null);
            setUpdated(Date.now());
            setNotice(`Место ${selected.number} удалено`);
          }}
        />
      )}
      {confirm === "release" && selected && (
        <ConfirmDialog
          title={`Освободить место ${selected.number}?`}
          description={`Госномер ${selected.license_plate} будет убран, место станет доступным. Эта операция не рассчитывает оплату и не создаёт талон выезда.`}
          action="Освободить"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            upsert(
              await parkingApi.update(selected.id, {
                ...spotInput(selected),
                status: "available",
                license_plate: null,
              }),
            );
            setNotice(`Место ${selected.number} свободно`);
          }}
        />
      )}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
    </div>
  );
}
function HelpDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal help-modal"
      aria-labelledby="help-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <div className="square-icon">
          <Icon name="info" />
        </div>
        <button
          autoFocus
          className="icon-button"
          aria-label="Закрыть помощь"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <h2 id="help-title">Работа с парковкой</h2>
      <p>Выберите место на схеме или в списке, чтобы открыть его карточку.</p>
      <ul>
        <li>
          <strong>Занять место</strong> — указать госномер автомобиля.
        </li>
        <li>
          <strong>Освободить</strong> — убрать госномер и сделать место
          доступным.
        </li>
        <li>
          <strong>Редактировать</strong> — изменить номер, тип транспорта или
          перевести место на обслуживание.
        </li>
      </ul>
      <p className="muted">
        Кнопка обновления загружает актуальные данные. Учёт платежей,
        бронирования и история въездов пока не подключены.
      </p>
      <button className="button primary" onClick={onClose}>
        Понятно
      </button>
    </dialog>
  );
}
export default App;
