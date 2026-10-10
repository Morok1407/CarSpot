use carspot_lib::parking::ParkingDb;
#[tokio::main]
async fn main() {
    match async { ParkingDb::from_env().await?.seed().await }.await {
        Ok(count) => println!("Added {count} parking spots."),
        Err(error) => {
            eprintln!("{}: {}", error.code, error.message);
            std::process::exit(1);
        }
    }
}
