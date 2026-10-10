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
}
export interface ApiError { code: string; message: string }
/** Requires the desktop Tauri runtime (npm run tauri dev). */
export const parkingApi = {
  list: (status: SpotStatus | null = null, offset = 0, limit = 100) =>
    invoke<ParkingSpot[]>("list_parking_spots", { status, offset, limit }),
  get: (id: string) => invoke<ParkingSpot>("get_parking_spot", { id }),
  create: (input: SpotInput) => invoke<ParkingSpot>("create_parking_spot", { input }),
  update: (id: string, input: SpotInput) => invoke<ParkingSpot>("update_parking_spot", { id, input }),
  delete: (id: string) => invoke<void>("delete_parking_spot", { id }),
  seed: () => invoke<number>("seed_parking_spots"),
};
