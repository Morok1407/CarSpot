import type { ParkingSpot, SpotStatus, VehicleType } from "./api/parking";
export const statusLabels: Record<SpotStatus, string> = {
  available: "Свободно",
  occupied: "Занято",
  maintenance: "Обслуживание",
};
export const vehicleLabels: Record<VehicleType, string> = {
  car: "Легковой автомобиль",
  motorcycle: "Мотоцикл",
  truck: "Грузовой автомобиль",
};
export const shortVehicleLabels: Record<VehicleType, string> = {
  car: "Легковые",
  motorcycle: "Мотоциклы",
  truck: "Грузовые",
};
export const vehicleTypes: VehicleType[] = ["car", "motorcycle", "truck"];
export function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  if (typeof error === "string") return error;
  return "Не удалось выполнить операцию. Попробуйте ещё раз.";
}
export function dateTime(value: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
export function spotInput(spot: ParkingSpot) {
  return {
    number: spot.number,
    vehicle_type: spot.vehicle_type,
    status: spot.status,
    license_plate: spot.license_plate,
  };
}
