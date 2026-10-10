pub mod history;
pub mod parking;
pub mod visits;
use parking::{ParkingDb, Result, SpotDto, SpotInput, SpotStatus};
use tokio::sync::OnceCell;
use visits::{AdmissionInput, PaymentMethod, PaymentSplit};

#[derive(Default)]
struct AppState(OnceCell<ParkingDb>);
impl AppState {
    async fn db(&self) -> Result<&ParkingDb> {
        self.0.get_or_try_init(ParkingDb::from_env).await
    }
}
#[tauri::command]
fn get_app_name() -> &'static str {
    "CarSpot"
}
#[tauri::command]
async fn list_parking_spots(
    state: tauri::State<'_, AppState>,
    status: Option<SpotStatus>,
    offset: Option<u64>,
    limit: Option<u32>,
) -> Result<Vec<SpotDto>> {
    state
        .db()
        .await?
        .list(status, offset.unwrap_or(0), limit.unwrap_or(100))
        .await
}
#[tauri::command]
async fn get_parking_spot(state: tauri::State<'_, AppState>, id: String) -> Result<SpotDto> {
    state.db().await?.get(&id).await
}
#[tauri::command]
async fn create_parking_spot(
    state: tauri::State<'_, AppState>,
    input: SpotInput,
) -> Result<SpotDto> {
    state.db().await?.create(input).await
}
#[tauri::command]
async fn update_parking_spot(
    state: tauri::State<'_, AppState>,
    id: String,
    input: SpotInput,
) -> Result<SpotDto> {
    state.db().await?.update(&id, input).await
}
#[tauri::command]
async fn delete_parking_spot(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    state.db().await?.delete(&id).await
}
#[tauri::command]
async fn seed_parking_spots(state: tauri::State<'_, AppState>) -> Result<u32> {
    state.db().await?.seed().await
}
#[tauri::command]
async fn admit_vehicle(
    state: tauri::State<'_, AppState>,
    id: String,
    input: AdmissionInput,
) -> Result<SpotDto> {
    state.db().await?.admit(&id, input).await
}
#[tauri::command]
async fn revise_visit(
    state: tauri::State<'_, AppState>,
    id: String,
    visit_id: String,
    input: AdmissionInput,
) -> Result<SpotDto> {
    state.db().await?.revise_visit(&id, &visit_id, input).await
}
#[tauri::command]
async fn pay_visit(
    state: tauri::State<'_, AppState>,
    id: String,
    visit_id: String,
    departure_at_ms: i64,
    method: PaymentMethod,
    expected_amount: i64,
    split: Option<PaymentSplit>,
) -> Result<SpotDto> {
    state
        .db()
        .await?
        .pay(
            &id,
            &visit_id,
            departure_at_ms,
            method,
            expected_amount,
            split,
        )
        .await
}
#[tauri::command]
async fn checkout_vehicle(
    state: tauri::State<'_, AppState>,
    id: String,
    visit_id: String,
) -> Result<SpotDto> {
    state.db().await?.checkout(&id, &visit_id).await
}
#[tauri::command]
async fn list_completed_visits(
    state: tauri::State<'_, AppState>,
    after: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<history::CompletedVisit>> {
    state
        .db()
        .await?
        .list_completed(after, limit.unwrap_or(200))
        .await
}
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_app_name,
            list_parking_spots,
            get_parking_spot,
            create_parking_spot,
            update_parking_spot,
            delete_parking_spot,
            seed_parking_spots,
            admit_vehicle,
            revise_visit,
            pay_visit,
            checkout_vehicle,
            list_completed_visits
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
