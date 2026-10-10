//! Additive demonstration data. Existing records are never overwritten.
use carspot_lib::{
    parking::ParkingDb,
    visits::{calculate_amount, Payment, PaymentMethod, TariffMode, Visit},
};
use mongodb::{
    bson::{doc, oid::ObjectId, to_bson, DateTime, Document},
    Client,
};

fn payment(method: PaymentMethod, entry: i64, until: i64, rate: i64, paid_at: i64) -> Payment {
    let amount = calculate_amount(entry, until, rate).expect("valid demo duration");
    let (cash, card) = match method {
        PaymentMethod::Mixed => {
            let cash = amount * 3 / 10;
            (cash, amount - cash)
        }
        _ => method.split(amount),
    };
    Payment {
        method,
        amount,
        paid_at_ms: paid_at,
        departure_at_ms: until,
        cash_amount: Some(cash),
        card_amount: Some(card),
    }
}

fn records(now: i64) -> Vec<(Document, Visit)> {
    const HOUR: i64 = 3_600_000;
    (0..60).map(|i: i64| {
        let (kind, prefix, local, base_rate) = if i < 40 { ("car", "A", i + 1, 500) } else if i < 50 { ("motorcycle", "M", i - 39, 200) } else { ("truck", "T", i - 49, 1000) };
        let number = format!("DEMO-{prefix}-{local:03}");
        let days_ago = if i < 21 { i % 7 } else if i < 42 { 7 + i - 21 } else { 30 + (i - 42) * 3 };
        let exit = now - days_ago * 24 * HOUR - (6 + i % 4) * HOUR;
        let entry = exit - (1 + (i * 7) % 9) * HOUR - (i % 3) * 15 * 60_000;
        let rate = base_rate + (i % 3) * 50;
        let method = match i % 3 { 0 => PaymentMethod::Cash, 1 => PaymentMethod::Card, _ => PaymentMethod::Mixed };
        let last = Visit { id: ObjectId::new().to_hex(), license_plate: format!("DEMO-OLD-{:03}", i+1), entry_at_ms: entry,
            planned_exit_at_ms: if i % 2 == 0 { Some(exit) } else { None }, tariff_mode: if i % 2 == 0 { TariffMode::Planned } else { TariffMode::Open },
            hourly_rate: rate, payment: Some(payment(method, entry, exit, rate, exit)), exited_at_ms: Some(exit) };
        let status = if i % 10 < 5 { "available" } else if i % 10 < 9 { "occupied" } else { "maintenance" };
        let active = if status == "occupied" {
            let entry = now - (45 + i % 5 * 15) * 60_000;
            let planned = i % 2 == 0;
            let end = if planned { entry + 2 * HOUR } else { now - 2 * 60_000 };
            Some(Visit { id: ObjectId::new().to_hex(), license_plate: format!("DEMO-NOW-{:03}", i+1), entry_at_ms: entry,
                planned_exit_at_ms: if planned { Some(end) } else { None }, tariff_mode: if planned { TariffMode::Planned } else { TariffMode::Open },
                hourly_rate: rate, payment: match i % 10 { 6 => Some(payment(PaymentMethod::Card, entry, end, rate, now - 60_000)),
                    7 => Some(payment(PaymentMethod::Mixed, entry, end, rate, end)), _ => None }, exited_at_ms: None })
        } else { None };
        (doc! { "_id": ObjectId::new(), "number": &number, "vehicle_type": kind, "status": status,
            "license_plate": active.as_ref().map(|v| v.license_plate.clone()), "active_visit": to_bson(&active).unwrap(),
            "created_at": DateTime::from_millis(entry - HOUR), "updated_at": DateTime::from_millis(now) }, last)
    }).collect()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db = ParkingDb::from_env().await.map_err(|e| e.message)?;
    let uri = std::env::var("MONGODB_URI").unwrap_or_else(|_| "mongodb://127.0.0.1:27017".into());
    let name = std::env::var("MONGODB_DATABASE").unwrap_or_else(|_| "CarSpot".into());
    let client = Client::with_uri_str(&uri).await?;
    let collection = client
        .database(&name)
        .collection::<Document>("parking_spots");
    let now = DateTime::now().timestamp_millis();
    let mut inserted = 0;
    for (record, mut visit) in records(now) {
        let number = record.get_str("number")?.to_owned();
        let result = collection
            .update_one(
                doc! { "number": record.get_str("number")? },
                doc! { "$setOnInsert": record },
            )
            .upsert(true)
            .await?;
        inserted += usize::from(result.upserted_id.is_some());
        let saved = collection
            .find_one(doc! { "number": &number })
            .await?
            .unwrap();
        let spot: carspot_lib::parking::Spot = mongodb::bson::from_document(saved)?;
        let spot: carspot_lib::parking::SpotDto = spot.into();
        let history = client
            .database(&name)
            .collection::<Document>("completed_visits");
        if history
            .find_one(doc! { "spot_id": &spot.id })
            .await?
            .is_none()
        {
            visit.id = format!("demo-initial-{}", spot.id);
            db.archive_visit(&carspot_lib::history::CompletedVisit::new(&spot, visit))
                .await
                .map_err(|e| e.message)?;
        }
    }
    println!("Database: {name}. Added {inserted} demo spots (DEMO-*); existing records preserved.");
    let mut cursor = collection
        .find(doc! { "number": { "$regex": "^DEMO-" } })
        .await?;
    let (mut total, mut free, mut occupied, mut service, mut visits, mut cash, mut card, mut mixed) =
        (0, 0, 0, 0, 0, 0, 0, 0);
    while cursor.advance().await? {
        let row = cursor.deserialize_current()?;
        total += 1;
        match row.get_str("status")? {
            "available" => free += 1,
            "occupied" => occupied += 1,
            _ => service += 1,
        }
        for key in ["active_visit"] {
            if let Ok(visit) = row.get_document(key) {
                visits += 1;
                if let Ok(payment) = visit.get_document("payment") {
                    match payment.get_str("method")? {
                        "cash" => cash += 1,
                        "card" => card += 1,
                        "mixed" => mixed += 1,
                        _ => {}
                    }
                }
            }
        }
    }
    println!("Verified demo records: {total}; available: {free}; occupied: {occupied}; maintenance: {service}.");
    let mut archive = client
        .database(&name)
        .collection::<Document>("completed_visits")
        .find(doc! { "spot_number": { "$regex": "^DEMO-" } })
        .await?;
    let mut completed = 0;
    while archive.advance().await? {
        let row = archive.deserialize_current()?;
        completed += 1;
        visits += 1;
        if let Ok(payment) = row.get_document("visit")?.get_document("payment") {
            match payment.get_str("method")? {
                "cash" => cash += 1,
                "card" => card += 1,
                "mixed" => mixed += 1,
                _ => {}
            }
        }
    }
    println!("Retained visits: {visits}; cash payments: {cash}; card: {card}; mixed: {mixed}.");
    let legacy = collection
        .count_documents(doc! { "last_visit": { "$exists": true } })
        .await?;
    println!("Completed demo visits: {completed}; spots with legacy history fields: {legacy}.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn demo_records_are_consistent_and_readable() {
        let now = 1_800_000_000_000;
        let docs = records(now);
        assert_eq!(docs.len(), 60);
        let mut numbers = std::collections::HashSet::new();
        for (doc, last) in docs {
            assert!(!doc.contains_key("last_visit"));
            let spot: carspot_lib::parking::Spot = mongodb::bson::from_document(doc).unwrap();
            assert!(numbers.insert(spot.data.number.clone()));
            for visit in std::iter::once(&last).chain(spot.active_visit.iter()) {
                if let Some(p) = &visit.payment {
                    assert_eq!(p.cash_amount.unwrap() + p.card_amount.unwrap(), p.amount);
                    assert_eq!(
                        calculate_amount(visit.entry_at_ms, p.departure_at_ms, visit.hourly_rate)
                            .unwrap(),
                        p.amount
                    );
                    assert!(p.paid_at_ms <= now);
                }
            }
            if let Some(active) = spot.active_visit {
                assert!(last.exited_at_ms.unwrap() < active.entry_at_ms);
            }
        }
    }
}
