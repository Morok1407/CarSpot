use mongodb::{
    bson::{doc, oid::ObjectId, to_document, DateTime},
    options::{ClientOptions, IndexOptions, ReturnDocument},
    Client, Collection, IndexModel,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub type Result<T> = std::result::Result<T, ApiError>;

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: &'static str,
    pub message: String,
}

fn error(code: &'static str, message: &str) -> ApiError {
    ApiError {
        code,
        message: message.into(),
    }
}

impl From<mongodb::error::Error> for ApiError {
    fn from(value: mongodb::error::Error) -> Self {
        use mongodb::error::{ErrorKind, WriteFailure};
        if matches!(value.kind.as_ref(), ErrorKind::Write(WriteFailure::WriteError(e)) if e.code == 11000)
        {
            return error("conflict", "Номер места или госномер уже используется");
        }
        // Не передаём в интерфейс адрес подключения и сведения об учётных данных.
        error(
            "database",
            "Ошибка MongoDB. Проверьте доступность сервера и настройки подключения",
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VehicleType {
    Motorcycle,
    Car,
    Truck,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SpotStatus {
    Available,
    Occupied,
    Maintenance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpotInput {
    pub number: String,
    pub vehicle_type: VehicleType,
    pub status: SpotStatus,
    pub license_plate: Option<String>,
}

impl SpotInput {
    fn validate(mut self) -> Result<Self> {
        self.number = self.number.trim().to_uppercase();
        if self.number.is_empty() || self.number.chars().count() > 20 {
            return Err(error(
                "validation",
                "Номер места должен содержать от 1 до 20 символов",
            ));
        }
        self.license_plate = self.license_plate.map(|s| s.trim().to_uppercase());
        if let Some(plate) = &self.license_plate {
            if plate.is_empty() || plate.chars().count() > 20 {
                return Err(error(
                    "validation",
                    "Госномер должен содержать от 1 до 20 символов",
                ));
            }
        }
        if (self.status == SpotStatus::Occupied) != self.license_plate.is_some() {
            return Err(error(
                "validation",
                "Госномер обязателен только для занятого места",
            ));
        }
        Ok(self)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Spot {
    #[serde(rename = "_id")]
    id: ObjectId,
    #[serde(flatten)]
    pub data: SpotInput,
    created_at: DateTime,
    updated_at: DateTime,
}

#[derive(Debug, Serialize)]
pub struct SpotDto {
    pub id: String,
    #[serde(flatten)]
    pub data: SpotInput,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

impl From<Spot> for SpotDto {
    fn from(s: Spot) -> Self {
        Self {
            id: s.id.to_hex(),
            data: s.data,
            created_at_ms: s.created_at.timestamp_millis(),
            updated_at_ms: s.updated_at.timestamp_millis(),
        }
    }
}

fn object_id(id: &str) -> Result<ObjectId> {
    ObjectId::parse_str(id).map_err(|_| error("validation", "Некорректный идентификатор места"))
}

pub struct ParkingDb {
    spots: Collection<Spot>,
}

impl ParkingDb {
    pub async fn connect(uri: &str, database: &str) -> Result<Self> {
        if database.is_empty() || database.chars().any(|c| "/\\. \"$\0".contains(c)) {
            return Err(error("configuration", "Некорректное имя базы MongoDB"));
        }
        let mut options = ClientOptions::parse(uri).await?;
        options.server_selection_timeout = Some(Duration::from_secs(5));
        options.connect_timeout = Some(Duration::from_secs(5));
        let client = Client::with_options(options)?;
        let db = client.database(database);
        db.run_command(doc! { "ping": 1 }).await?;
        let spots = db.collection::<Spot>("parking_spots");
        spots
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "number": 1 })
                    .options(IndexOptions::builder().unique(true).build())
                    .build(),
            )
            .await?;
        spots
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "license_plate": 1 })
                    .options(
                        IndexOptions::builder()
                            .unique(true)
                            .partial_filter_expression(
                                doc! { "license_plate": { "$type": "string" } },
                            )
                            .build(),
                    )
                    .build(),
            )
            .await?;
        Ok(Self { spots })
    }

    pub async fn from_env() -> Result<Self> {
        Self::connect(
            &std::env::var("MONGODB_URI").unwrap_or_else(|_| "mongodb://127.0.0.1:27017".into()),
            &std::env::var("MONGODB_DATABASE").unwrap_or_else(|_| "CarSpot".into()),
        )
        .await
    }

    pub async fn create(&self, input: SpotInput) -> Result<SpotDto> {
        let now = DateTime::now();
        let spot = Spot {
            id: ObjectId::new(),
            data: input.validate()?,
            created_at: now,
            updated_at: now,
        };
        self.spots.insert_one(&spot).await?;
        Ok(spot.into())
    }

    pub async fn get(&self, id: &str) -> Result<SpotDto> {
        self.spots
            .find_one(doc! { "_id": object_id(id)? })
            .await?
            .map(Into::into)
            .ok_or_else(|| error("not_found", "Место не найдено"))
    }

    pub async fn list(
        &self,
        status: Option<SpotStatus>,
        offset: u64,
        limit: u32,
    ) -> Result<Vec<SpotDto>> {
        if !(1..=200).contains(&limit) {
            return Err(error("validation", "Размер страницы: от 1 до 200"));
        }
        let filter = match status {
            Some(s) => doc! { "status": mongodb::bson::to_bson(&s).unwrap() },
            None => doc! {},
        };
        let mut cursor = self
            .spots
            .find(filter)
            .sort(doc! { "number": 1 })
            .skip(offset)
            .limit(i64::from(limit))
            .await?;
        let mut result = Vec::new();
        while cursor.advance().await? {
            result.push(cursor.deserialize_current()?.into());
        }
        Ok(result)
    }

    pub async fn update(&self, id: &str, input: SpotInput) -> Result<SpotDto> {
        let input = input.validate()?;
        let mut fields =
            to_document(&input).map_err(|_| error("validation", "Ошибка сериализации места"))?;
        fields.insert("updated_at", DateTime::now());
        self.spots
            .find_one_and_update(doc! { "_id": object_id(id)? }, doc! { "$set": fields })
            .return_document(ReturnDocument::After)
            .await?
            .map(Into::into)
            .ok_or_else(|| error("not_found", "Место не найдено"))
    }

    pub async fn delete(&self, id: &str) -> Result<()> {
        let id = object_id(id)?;
        let result = self
            .spots
            .delete_one(doc! { "_id": id, "status": { "$ne": "occupied" } })
            .await?;
        if result.deleted_count == 0 {
            if self.spots.find_one(doc! { "_id": id }).await?.is_some() {
                return Err(error("conflict", "Нельзя удалить занятое место"));
            }
            return Err(error("not_found", "Место не найдено"));
        }
        Ok(())
    }

    /// Явное заполнение: существующие записи никогда не изменяются.
    pub async fn seed(&self) -> Result<u32> {
        let mut inserted = 0;
        for (prefix, count, kind) in [
            ("A", 40, VehicleType::Car),
            ("M", 5, VehicleType::Motorcycle),
            ("T", 5, VehicleType::Truck),
        ] {
            for n in 1..=count {
                let number = format!("{prefix}-{n:03}");
                let now = DateTime::now();
                let spot = Spot {
                    id: ObjectId::new(),
                    data: SpotInput {
                        number: number.clone(),
                        vehicle_type: kind.clone(),
                        status: SpotStatus::Available,
                        license_plate: None,
                    },
                    created_at: now,
                    updated_at: now,
                };
                let fields = to_document(&spot)
                    .map_err(|_| error("validation", "Ошибка сериализации места"))?;
                match self
                    .spots
                    .update_one(doc! { "number": number }, doc! { "$setOnInsert": fields })
                    .upsert(true)
                    .await
                {
                    Ok(r) => inserted += u32::from(r.upserted_id.is_some()),
                    Err(e) => {
                        let e = ApiError::from(e);
                        if e.code != "conflict" {
                            return Err(e);
                        }
                    }
                }
            }
        }
        Ok(inserted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(status: SpotStatus, plate: Option<&str>) -> SpotInput {
        SpotInput {
            number: " a-001 ".into(),
            vehicle_type: VehicleType::Car,
            status,
            license_plate: plate.map(Into::into),
        }
    }
    #[test]
    fn validation() {
        assert_eq!(
            input(SpotStatus::Available, None)
                .validate()
                .unwrap()
                .number,
            "A-001"
        );
        assert!(input(SpotStatus::Occupied, None).validate().is_err());
        assert!(input(SpotStatus::Available, Some("ABC"))
            .validate()
            .is_err());
        assert!(input(SpotStatus::Occupied, Some("  ")).validate().is_err());
        assert_eq!(
            input(SpotStatus::Occupied, Some(" abc "))
                .validate()
                .unwrap()
                .license_plate
                .as_deref(),
            Some("ABC")
        );
        assert!(object_id("invalid").is_err());
    }

    #[tokio::test]
    #[ignore = "Requires local MongoDB; creates and drops a uniquely named test database"]
    async fn mongo_crud() {
        let name = format!("carspot_test_{}", ObjectId::new().to_hex());
        let uri =
            std::env::var("MONGODB_URI").unwrap_or_else(|_| "mongodb://127.0.0.1:27017".into());
        let db = ParkingDb::connect(&uri, &name).await.unwrap();
        assert_eq!(db.seed().await.unwrap(), 50);
        assert_eq!(db.seed().await.unwrap(), 0);
        let spots = db.list(None, 0, 100).await.unwrap();
        assert_eq!(spots.len(), 50);
        let id = &spots[0].id;
        let occupied = db
            .update(id, input(SpotStatus::Occupied, Some("ABC")))
            .await
            .unwrap();
        assert_eq!(occupied.data.status, SpotStatus::Occupied);
        assert_eq!(db.delete(id).await.unwrap_err().code, "conflict");
        assert_eq!(
            db.create(input(SpotStatus::Available, None))
                .await
                .unwrap_err()
                .code,
            "conflict"
        );
        let mut other = input(SpotStatus::Occupied, Some("ABC"));
        other.number = "OTHER".into();
        assert_eq!(db.create(other).await.unwrap_err().code, "conflict");
        db.seed().await.unwrap();
        assert_eq!(db.get(id).await.unwrap().data.status, SpotStatus::Occupied);
        db.update(id, input(SpotStatus::Available, None))
            .await
            .unwrap();
        db.delete(id).await.unwrap();
        assert_eq!(db.get(id).await.unwrap_err().code, "not_found");
        let created = db.create(input(SpotStatus::Available, None)).await.unwrap();
        assert_eq!(db.get(&created.id).await.unwrap().data.number, "A-001");
        Client::with_uri_str(&uri)
            .await
            .unwrap()
            .database(&name)
            .drop()
            .await
            .unwrap();
    }
}
