import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ParkingSpot,
  SpotInput,
  SpotStatus,
  VehicleType,
} from "../api/parking";
import { errorMessage, vehicleLabels, vehicleTypes } from "../parking";
import { Icon } from "./Icon";
export type FormMode = "create" | "edit";
export function SpotForm({
  mode,
  spot,
  onClose,
  onSave,
}: {
  mode: FormMode;
  spot?: ParkingSpot;
  onClose: () => void;
  onSave: (input: SpotInput) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [number, setNumber] = useState(spot?.number ?? "");
  const [type, setType] = useState<VehicleType>(spot?.vehicle_type ?? "car");
  const [status, setStatus] = useState<SpotStatus>(spot?.status ?? "available");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave({
        number,
        vehicle_type: type,
        status,
        license_plate:
          status === "occupied" ? (spot?.license_plate ?? null) : null,
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="form-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
    >
      <div className="modal-heading">
        <div className="square-icon">
          <Icon name="map" />
        </div>
        <button
          className="icon-button"
          aria-label="Закрыть форму"
          disabled={saving}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <h2 id="form-title">
        {mode === "create"
          ? "Новое парковочное место"
          : "Редактировать " + spot?.number}
      </h2>
      <p className="muted">
        Параметры места. Для автомобиля используйте кнопку «Принять автомобиль».
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={saving}>
          <label>
            Номер места
            <input
              autoFocus
              required
              maxLength={20}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Например, A-041"
            />
          </label>
          <label>
            Тип транспорта
            <select
              value={type}
              onChange={(e) => setType(e.target.value as VehicleType)}
            >
              {vehicleTypes.map((t) => (
                <option key={t} value={t}>
                  {vehicleLabels[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Состояние
            <select
              disabled={spot?.status === "occupied"}
              value={status}
              onChange={(e) => setStatus(e.target.value as SpotStatus)}
            >
              <option value="available">Свободно</option>
              {spot?.status === "occupied" && (
                <option value="occupied">Занято</option>
              )}
              <option value="maintenance">Обслуживание</option>
            </select>
          </label>
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
            <button type="submit" className="button primary">
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
export function ConfirmDialog({
  title,
  description,
  action,
  danger = false,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  action: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="confirm-title">{title}</h2>
      <p className="muted">{description}</p>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button
          autoFocus
          disabled={busy}
          className="button secondary"
          onClick={onClose}
        >
          Отмена
        </button>
        <button
          disabled={busy}
          className={`button ${danger ? "danger" : "primary"}`}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          {busy ? "Выполнение…" : action}
        </button>
      </div>
    </dialog>
  );
}
