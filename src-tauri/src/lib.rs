pub mod parking;
use parking::{ParkingDb, Result, SpotDto, SpotInput, SpotStatus};
use tokio::sync::OnceCell;

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
            seed_parking_spots
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
