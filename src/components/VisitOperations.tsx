import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  parkingApi,
  type AdmissionInput,
  type ParkingSpot,
  type PaymentMethod,
  type TariffMode,
  type Visit,
} from "../api/parking";
import { dateTime, errorMessage, vehicleLabels } from "../parking";
import { Icon } from "./Icon";

export const money = (amount: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(amount) +
  " ₸";
function localDate(ms: number) {
  const date = new Date(ms);
  return new Date(ms - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
}
function amount(entry: number, exit: number, rate: number) {
  return Number.isFinite(entry) &&
    Number.isFinite(exit) &&
    exit > entry &&
    rate > 0
    ? Math.ceil((exit - entry) / 3600000) * rate
    : null;
}

export function AdmissionDialog({
  spots,
  initialSpot,
  editing = false,
  onClose,
  onSaved,
}: {
  spots: ParkingSpot[];
  initialSpot?: ParkingSpot;
  editing?: boolean;
  onClose: () => void;
  onSaved: (spot: ParkingSpot) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const visit = editing ? initialSpot?.active_visit : null;
  const available = spots.filter(
    (s) => s.status === "available" || s.id === initialSpot?.id,
  );
  const [spotId, setSpotId] = useState(
    initialSpot?.id ?? available[0]?.id ?? "",
  );
  const [plate, setPlate] = useState(
    visit?.license_plate ?? initialSpot?.license_plate ?? "",
  );
  const [entry, setEntry] = useState(
    localDate(visit?.entry_at_ms ?? Date.now()),
  );
  const [exit, setExit] = useState(
    localDate(visit?.planned_exit_at_ms ?? Date.now() + 3600000),
  );
  const [mode, setMode] = useState<TariffMode>(visit?.tariff_mode ?? "open");
  const [rate, setRate] = useState(String(visit?.hourly_rate ?? 500));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview =
    mode === "planned"
      ? amount(
          new Date(entry).getTime(),
          new Date(exit).getTime(),
          Number(rate),
        )
      : null;
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const input: AdmissionInput = {
      license_plate: plate,
      entry_at_ms: new Date(entry).getTime(),
      planned_exit_at_ms: mode === "planned" ? new Date(exit).getTime() : null,
      tariff_mode: mode,
      hourly_rate: Number(rate),
    };
    try {
      const result = visit
        ? await parkingApi.revise(spotId, visit.id, input)
        : await parkingApi.admit(spotId, input);
      onSaved(result);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="modal visit-modal"
      aria-labelledby="visit-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <span className="square-icon">
          <Icon name="car" />
        </span>
        <button
          disabled={busy}
          className="icon-button"
          aria-label="Закрыть приём автомобиля"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <h2 id="visit-title">
        {editing ? "Изменить условия стоянки" : "Приём автомобиля"}
      </h2>
      <p className="muted">
        {editing
          ? "Время и тариф можно изменить до оплаты."
          : "Выберите место, укажите госномер и условия стоянки."}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Парковочное место
            <select
              required
              value={spotId}
              disabled={!!initialSpot}
              onChange={(e) => setSpotId(e.target.value)}
            >
              <option value="" disabled>
                Выберите свободное место
              </option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} · {vehicleLabels[s.vehicle_type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Государственный номер
            <input
              autoFocus
              required
              maxLength={20}
              pattern=".*\S.*"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder="123 ABC 01"
            />
          </label>
          <label>
            Время въезда
            <input
              type="datetime-local"
              step="1"
              required
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
            />
          </label>
          <div className="tariff-choice" role="group" aria-label="Режим тарифа">
            <button
              type="button"
              className={mode === "planned" ? "chosen" : ""}
              aria-pressed={mode === "planned"}
              onClick={() => setMode("planned")}
            >
              <Icon name="clock" size={18} />
              <strong>По времени</strong>
              <small>На выбранный срок</small>
            </button>
            <button
              type="button"
              className={mode === "open" ? "chosen" : ""}
              aria-pressed={mode === "open"}
              onClick={() => setMode("open")}
            >
              <Icon name="car" size={18} />
              <strong>Открытый тариф</strong>
              <small>Оплата при выезде</small>
            </button>
          </div>
          {mode === "planned" && (
            <label>
              Планируемое время выезда
              <input
                type="datetime-local"
                step="1"
                required
                value={exit}
                min={entry}
                onChange={(e) => setExit(e.target.value)}
              />
            </label>
          )}
          <label>
            Тариф, ₸ / час
            <input
              type="number"
              min="1"
              max="1000000"
              step="1"
              required
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
          <div className="billing-preview">
            <span>
              {mode === "open"
                ? "Расчёт при выезде"
                : "Стоимость выбранного периода"}
            </span>
            <strong>
              {mode === "open"
                ? `${money(Number(rate) || 0)} / ч`
                : preview === null
                  ? "Проверьте время"
                  : money(preview)}
            </strong>
            <p>
              {mode === "open"
                ? "По фактическому времени. Неполный час округляется вверх."
                : "Неполный час округляется вверх. Стоимость периода фиксированная, без перерасчёта при раннем или позднем выезде."}
            </p>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Отмена
            </button>
            <button disabled={!spotId} className="button primary" type="submit">
              {busy
                ? "Сохранение…"
                : editing
                  ? "Сохранить условия"
                  : "Принять автомобиль"}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}

export function PaymentDialog({
  spot,
  onClose,
  onSaved,
}: {
  spot: ParkingSpot;
  onClose: () => void;
  onSaved: (spot: ParkingSpot) => void;
}) {
  const visit = spot.active_visit!;
  const ref = useRef<HTMLDialogElement>(null);
  const [exit, setExit] = useState(localDate(Date.now()));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [split, setSplit] = useState<{ cash: string; card: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const departure =
    visit.tariff_mode === "planned"
      ? visit.planned_exit_at_ms!
      : new Date(exit).getTime();
  const total = amount(visit.entry_at_ms, departure, visit.hourly_rate);
  const cash = split?.cash ?? String(Math.floor((total ?? 0) / 2));
  const card = split?.card ?? String(Math.ceil((total ?? 0) / 2));
  const cashAmount = Number(cash),
    cardAmount = Number(card);
  const splitValid =
    total !== null &&
    Number.isSafeInteger(cashAmount) &&
    Number.isSafeInteger(cardAmount) &&
    cashAmount > 0 &&
    cardAmount > 0 &&
    cashAmount + cardAmount === total;
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || total === null || (method === "mixed" && !splitValid)) return;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await parkingApi.pay(
          spot.id,
          visit.id,
          departure,
          method,
          total,
          method === "mixed"
            ? { cash_amount: cashAmount, card_amount: cardAmount }
            : null,
        ),
      );
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="modal visit-modal"
      aria-labelledby="payment-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <span className="square-icon">
          <Icon name="check" />
        </span>
        <button
          disabled={busy}
          className="icon-button"
          aria-label="Закрыть оплату"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <h2 id="payment-title">Оплата стоянки</h2>
      <p className="muted">
        {spot.number} · {visit.license_plate}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <dl>
            <div>
              <dt>Въезд</dt>
              <dd>{dateTime(visit.entry_at_ms)}</dd>
            </div>
            <div>
              <dt>Тариф</dt>
              <dd>{money(visit.hourly_rate)} / ч</dd>
            </div>
          </dl>
          {visit.tariff_mode === "open" ? (
            <label>
              Фактическое время выезда
              <input
                type="datetime-local"
                step="1"
                required
                value={exit}
                min={localDate(visit.entry_at_ms)}
                onChange={(e) => setExit(e.target.value)}
              />
              <button
                type="button"
                className="text-button"
                onClick={() => setExit(localDate(Date.now()))}
              >
                Установить текущее время
              </button>
            </label>
          ) : (
            <p className="muted">
              Выбранный период — до {dateTime(departure)}. Сумма не зависит от
              фактического времени выезда.
            </p>
          )}
          <div className="billing-preview">
            <span>
              К оплате ·{" "}
              {total === null
                ? "—"
                : Math.ceil((departure - visit.entry_at_ms) / 3600000)}{" "}
              ч
            </span>
            <strong>{total === null ? "Проверьте время" : money(total)}</strong>
            <p>Неполный час округляется вверх.</p>
          </div>
          <div
            className="payment-methods"
            role="group"
            aria-label="Способ оплаты"
          >
            <button
              type="button"
              aria-pressed={method === "cash"}
              className={method === "cash" ? "chosen" : ""}
              onClick={() => setMethod("cash")}
            >
              Наличные
            </button>
            <button
              type="button"
              aria-pressed={method === "card"}
              className={method === "card" ? "chosen" : ""}
              onClick={() => setMethod("card")}
            >
              Карта
            </button>
            <button
              type="button"
              aria-pressed={method === "mixed"}
              className={method === "mixed" ? "chosen" : ""}
              onClick={() => setMethod("mixed")}
            >
              Смешанная
            </button>
          </div>
          {method === "mixed" && total !== null && (
            <div className="payment-split">
              <label>
                Наличными, ₸
                <input
                  type="number"
                  min="1"
                  max={total}
                  step="1"
                  required
                  value={cash}
                  onChange={(e) => setSplit({ cash: e.target.value, card })}
                />
              </label>
              <label>
                Картой, ₸
                <input
                  type="number"
                  min="1"
                  max={total}
                  step="1"
                  required
                  value={card}
                  onChange={(e) => setSplit({ cash, card: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => setSplit(null)}
              >
                Разделить поровну
              </button>
              <small role="status">
                {splitValid
                  ? `Итого: ${money(cashAmount + cardAmount)}`
                  : `Укажите две положительные суммы с итогом ${money(total)}. Сейчас: ${money((Number.isFinite(cashAmount) ? cashAmount : 0) + (Number.isFinite(cardAmount) ? cardAmount : 0))}.`}
              </small>
            </div>
          )}
          <p className="muted">
            Кнопка фиксирует полученную оплату. Деньги с карты не списываются.
          </p>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              className="button primary"
              disabled={total === null || (method === "mixed" && !splitValid)}
              type="submit"
            >
              {busy ? "Сохранение…" : "Оплатить"}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}

export function VisitSummary({
  visit,
  completed = false,
}: {
  visit: Visit;
  completed?: boolean;
}) {
  return (
    <section className="visit-summary">
      <h3>
        <Icon name="clock" size={17} />
        {completed ? "Последний завершённый визит" : "Текущая стоянка"}
      </h3>
      <div className="visit-steps">
        <span className="done">1. Приём</span>
        <span className={visit.payment ? "done" : ""}>2. Оплата</span>
        <span className={completed ? "done" : ""}>3. Выезд</span>
      </div>
      <dl>
        {completed && (
          <div>
            <dt>Автомобиль</dt>
            <dd>{visit.license_plate}</dd>
          </div>
        )}
        <div>
          <dt>Въезд</dt>
          <dd>{dateTime(visit.entry_at_ms)}</dd>
        </div>
        <div>
          <dt>Режим</dt>
          <dd>
            {visit.tariff_mode === "open" ? "Открытый тариф" : "По времени"}
          </dd>
        </div>
        <div>
          <dt>Тариф</dt>
          <dd>{money(visit.hourly_rate)} / ч</dd>
        </div>
        <div>
          <dt>{completed ? "Выезд" : "Планируемый выезд"}</dt>
          <dd>
            {completed && visit.exited_at_ms
              ? dateTime(visit.exited_at_ms)
              : visit.planned_exit_at_ms
                ? dateTime(visit.planned_exit_at_ms)
                : "Без ограничения"}
          </dd>
        </div>
      </dl>
      {visit.payment ? (
        <div className="payment-receipt">
          <Icon name="check" size={17} />
          <div>
            <strong>Оплачено {money(visit.payment.amount)}</strong>
            <small>
              {visit.payment.method === "mixed"
                ? "Смешанная"
                : visit.payment.method === "cash"
                  ? "Наличные"
                  : "Карта"}{" "}
              · {dateTime(visit.payment.paid_at_ms)}
            </small>
            {visit.payment.method === "mixed" && (
              <small>
                Наличные:{" "}
                {money(
                  visit.payment.cash_amount ??
                    Math.floor(visit.payment.amount / 2),
                )}{" "}
                · Карта:{" "}
                {money(
                  visit.payment.card_amount ??
                    Math.ceil(visit.payment.amount / 2),
                )}
              </small>
            )}
          </div>
        </div>
      ) : (
        <div className="payment-pending">
          Ожидает оплаты
          {visit.tariff_mode === "planned" && (
            <strong>
              {money(
                amount(
                  visit.entry_at_ms,
                  visit.planned_exit_at_ms!,
                  visit.hourly_rate,
                ) ?? 0,
              )}
            </strong>
          )}
        </div>
      )}
    </section>
  );
}
