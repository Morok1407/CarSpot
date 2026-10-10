use crate::{
    parking::{error, ParkingDb, Result, SpotDto, VehicleType},
    visits::Visit,
};
use mongodb::{
    bson::{doc, from_document, to_document, DateTime, Document},
    IndexModel,
};
use serde::{Deserialize, Serialize};

/// A snapshot survives renaming or deleting the parking spot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletedVisit {
    #[serde(rename = "_id")]
    pub id: String,
    pub spot_id: String,
    pub spot_number: String,
    pub vehicle_type: VehicleType,
    pub visit: Visit,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        parking::{SpotInput, SpotStatus},
        visits::{Payment, PaymentMethod, TariffMode},
    };
    use mongodb::{
        bson::{oid::ObjectId, to_bson},
        Client,
    };

    #[tokio::test]
    #[ignore = "Requires local MongoDB; isolated temporary database"]
    async fn migration_recovery_and_retention() {
        let uri =
            std::env::var("MONGODB_URI").unwrap_or_else(|_| "mongodb://127.0.0.1:27017".into());
        let name = format!("carspot_test_{}", ObjectId::new().to_hex());
        let db = ParkingDb::connect(&uri, &name).await.unwrap();
        let spot = db
            .create(SpotInput {
                number: "HISTORY".into(),
                vehicle_type: VehicleType::Car,
                status: SpotStatus::Available,
                license_plate: None,
            })
            .await
            .unwrap();
        let visit = Visit {
            id: ObjectId::new().to_hex(),
            license_plate: "OLD".into(),
            entry_at_ms: 1000,
            planned_exit_at_ms: None,
            tariff_mode: TariffMode::Open,
            hourly_rate: 500,
            exited_at_ms: Some(3_601_000),
            payment: Some(Payment {
                method: PaymentMethod::Mixed,
                amount: 500,
                paid_at_ms: 3_601_000,
                departure_at_ms: 3_601_000,
                cash_amount: Some(100),
                card_amount: Some(400),
            }),
        };
        let raw = db.spots.clone_with_type::<Document>();
        raw.update_one(
            doc! { "_id": crate::parking::object_id(&spot.id).unwrap() },
            doc! { "$set": { "last_visit": to_bson(&visit).unwrap() } },
        )
        .await
        .unwrap();
        db.initialize_history().await.unwrap();
        db.initialize_history().await.unwrap();
        assert_eq!(db.list_completed(None, 200).await.unwrap().len(), 1);
        assert!(!raw
            .find_one(doc! {})
            .await
            .unwrap()
            .unwrap()
            .contains_key("last_visit"));
        // Simulate the exact crash window: archive written, active spot not cleared.
        let mut next = visit.clone();
        next.id = ObjectId::new().to_hex();
        next.license_plate = "NEXT".into();
        let record = CompletedVisit::new(&spot, next.clone());
        next.exited_at_ms = None;
        raw.update_one(doc! {}, doc! { "$set": { "active_visit": to_bson(&next).unwrap(), "status": "occupied", "license_plate": "NEXT" } }).await.unwrap();
        db.archive_visit(&record).await.unwrap();
        db.archive_visit(&record).await.unwrap();
        let reopened = ParkingDb::connect(&uri, &name).await.unwrap();
        assert!(reopened.get(&spot.id).await.unwrap().active_visit.is_none());
        let first = reopened.list_completed(None, 1).await.unwrap();
        let second = reopened
            .list_completed(Some(first[0].id.clone()), 1)
            .await
            .unwrap();
        assert_eq!(second.len(), 1);
        assert_ne!(first[0].id, second[0].id);
        reopened.delete(&spot.id).await.unwrap();
        let history = reopened.list_completed(None, 200).await.unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].spot_number, "HISTORY");
        assert_eq!(
            history[0].visit.payment.as_ref().unwrap().cash_amount,
            Some(100)
        );
        Client::with_uri_str(&uri)
            .await
            .unwrap()
            .database(&name)
            .drop()
            .await
            .unwrap();
    }
}

impl CompletedVisit {
    pub fn new(spot: &SpotDto, visit: Visit) -> Self {
        Self {
            id: visit.id.clone(),
            spot_id: spot.id.clone(),
            spot_number: spot.data.number.clone(),
            vehicle_type: spot.data.vehicle_type.clone(),
            visit,
        }
    }
}

impl ParkingDb {
    pub(crate) async fn initialize_history(&self) -> Result<()> {
        self.history
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "spot_id": 1, "visit.exited_at_ms": -1 })
                    .build(),
            )
            .await?;
        // Read old fields as raw BSON before deserializing the new Spot model.
        let raw = self.spots.clone_with_type::<Document>();
        let mut cursor = raw
            .find(doc! { "last_visit": { "$type": "object" } })
            .await?;
        while cursor.advance().await? {
            let mut document = cursor.deserialize_current()?;
            let legacy = document.remove("last_visit").unwrap();
            let visit: Visit = mongodb::bson::from_bson(legacy).map_err(|_| {
                error(
                    "migration",
                    "Не удалось прочитать старую историю. Исходная запись сохранена",
                )
            })?;
            let spot: crate::parking::Spot = from_document(document).map_err(|_| {
                error(
                    "migration",
                    "Не удалось прочитать место при переносе истории",
                )
            })?;
            let spot: SpotDto = spot.into();
            self.archive_visit(&CompletedVisit::new(&spot, visit.clone()))
                .await?;
            raw.update_one(
                doc! { "_id": crate::parking::object_id(&spot.id)?, "last_visit.id": &visit.id },
                doc! { "$unset": { "last_visit": "" } },
            )
            .await?;
        }
        raw.update_many(
            doc! { "last_visit": { "$type": "null" } },
            doc! { "$unset": { "last_visit": "" } },
        )
        .await?;
        // Recover a crash after archiving but before releasing a spot. Match visit ID
        // so recovery can never clear a newer admission.
        let mut cursor = self
            .spots
            .find(doc! { "active_visit.payment": { "$type": "object" } })
            .await?;
        while cursor.advance().await? {
            let spot: SpotDto = cursor.deserialize_current()?.into();
            if let Some(visit) = &spot.active_visit {
                if self
                    .history
                    .find_one(doc! { "_id": &visit.id, "spot_id": &spot.id })
                    .await?
                    .is_some()
                {
                    self.release_archived(&spot.id, &visit.id).await?;
                }
            }
        }
        Ok(())
    }

    pub async fn archive_visit(&self, record: &CompletedVisit) -> Result<()> {
        if record.visit.exited_at_ms.is_none() || record.id != record.visit.id {
            return Err(error(
                "validation",
                "В историю можно записать только завершённую стоянку",
            ));
        }
        let fields =
            to_document(record).map_err(|_| error("validation", "Ошибка сериализации истории"))?;
        // The immutable visit ID makes retries idempotent. Archive first: a failed
        // write never releases the spot and never loses its paid visit.
        match self
            .history
            .update_one(doc! { "_id": &record.id }, doc! { "$setOnInsert": fields })
            .upsert(true)
            .await
        {
            Ok(_) => Ok(()),
            Err(e) => {
                let e = crate::parking::ApiError::from(e);
                if e.code == "conflict"
                    && self
                        .history
                        .find_one(doc! { "_id": &record.id, "spot_id": &record.spot_id })
                        .await?
                        .is_some()
                {
                    Ok(())
                } else {
                    Err(e)
                }
            }
        }
    }

    pub(crate) async fn release_archived(&self, id: &str, visit_id: &str) -> Result<()> {
        self.spots.update_one(doc! { "_id": crate::parking::object_id(id)?, "active_visit.id": visit_id, "active_visit.payment": { "$type": "object" } },
            doc! { "$set": { "active_visit": null, "status": "available", "license_plate": null, "updated_at": DateTime::now() }, "$unset": { "last_visit": "" } }).await?;
        Ok(())
    }

    pub async fn list_completed(
        &self,
        after: Option<String>,
        limit: u32,
    ) -> Result<Vec<CompletedVisit>> {
        if !(1..=200).contains(&limit) {
            return Err(error("validation", "Размер страницы: от 1 до 200"));
        }
        let filter = after
            .map(|id| doc! { "_id": { "$gt": id } })
            .unwrap_or_default();
        let mut cursor = self
            .history
            .find(filter)
            .sort(doc! { "_id": 1 })
            .limit(i64::from(limit))
            .await?;
        let mut result = Vec::new();
        while cursor.advance().await? {
            result.push(cursor.deserialize_current()?);
        }
        Ok(result)
    }
}
