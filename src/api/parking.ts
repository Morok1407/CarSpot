import { invoke } from "@tauri-apps/api/core";
export type VehicleType = "motorcycle" | "car" | "truck";
export type SpotStatus = "available" | "occupied" | "maintenance";
export interface SpotInput {
  number: string;
  vehicle_type: VehicleType;
  status: SpotStatus;
  license_plate: string | null;
}
export interface ParkingSpot extends SpotInput {
  id: string;
  created_at_ms: number;
  updated_at_ms: number;
  active_visit: Visit | null;
  last_visit: Visit | null;
}
export type TariffMode = "planned" | "open";
export type PaymentMethod = "cash" | "card";
export interface AdmissionInput {
  license_plate: string;
  entry_at_ms: number;
  planned_exit_at_ms: number | null;
  tariff_mode: TariffMode;
  hourly_rate: number;
}
export interface Visit extends AdmissionInput {
  id: string;
  payment: {
    method: PaymentMethod;
    amount: number;
    paid_at_ms: number;
    departure_at_ms: number;
  } | null;
  exited_at_ms: number | null;
}
export interface ApiError {
  code: string;
  message: string;
}
/** Requires the desktop Tauri runtime (npm run tauri dev). */
export const parkingApi = {
  list: (status: SpotStatus | null = null, offset = 0, limit = 100) =>
    invoke<ParkingSpot[]>("list_parking_spots", { status, offset, limit }),
  get: (id: string) => invoke<ParkingSpot>("get_parking_spot", { id }),
  create: (input: SpotInput) =>
    invoke<ParkingSpot>("create_parking_spot", { input }),
  update: (id: string, input: SpotInput) =>
    invoke<ParkingSpot>("update_parking_spot", { id, input }),
  delete: (id: string) => invoke<void>("delete_parking_spot", { id }),
  seed: () => invoke<number>("seed_parking_spots"),
  admit: (id: string, input: AdmissionInput) =>
    invoke<ParkingSpot>("admit_vehicle", { id, input }),
  revise: (id: string, visitId: string, input: AdmissionInput) =>
    invoke<ParkingSpot>("revise_visit", { id, visitId, input }),
  pay: (
    id: string,
    visitId: string,
    departureAtMs: number,
    method: PaymentMethod,
    expectedAmount: number,
  ) =>
    invoke<ParkingSpot>("pay_visit", {
      id,
      visitId,
      departureAtMs,
      method,
      expectedAmount,
    }),
  checkout: (id: string, visitId: string) =>
    invoke<ParkingSpot>("checkout_vehicle", { id, visitId }),
};
