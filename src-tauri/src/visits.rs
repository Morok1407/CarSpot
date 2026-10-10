use crate::parking::{error, object_id, ParkingDb, Result, SpotDto, SpotStatus};
use mongodb::{
    bson::{doc, oid::ObjectId, to_bson, DateTime},
    options::ReturnDocument,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentMethod {
    Cash,
    Card,
    Mixed,
}

impl PaymentMethod {
    pub fn split(&self, amount: i64) -> (i64, i64) {
        match self {
            Self::Cash => (amount, 0),
            Self::Card => (0, amount),
            Self::Mixed => (amount / 2, amount - amount / 2),
        }
    }

    fn validate_split(&self, amount: i64, split: Option<PaymentSplit>) -> Result<(i64, i64)> {
        match (self, split) {
            (Self::Mixed, Some(s)) if s.cash_amount > 0 && s.card_amount > 0
                && s.cash_amount.checked_add(s.card_amount) == Some(amount) => Ok((s.cash_amount, s.card_amount)),
            (Self::Mixed, _) => Err(error("validation", "Укажите положительные суммы наличными и картой. Их сумма должна совпадать со стоимостью стоянки")),
            (_, None) => Ok(self.split(amount)),
            (_, Some(_)) => Err(error("validation", "Распределение суммы допустимо только для смешанной оплаты")),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentSplit {
    pub cash_amount: i64,
    pub card_amount: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TariffMode {
    Planned,
    Open,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payment {
    pub method: PaymentMethod,
    pub amount: i64,
    pub paid_at_ms: i64,
    pub departure_at_ms: i64,
    #[serde(default)]
    pub cash_amount: Option<i64>,
    #[serde(default)]
    pub card_amount: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Visit {
    pub id: String,
    pub license_plate: String,
    pub entry_at_ms: i64,
    pub planned_exit_at_ms: Option<i64>,
    pub tariff_mode: TariffMode,
    pub hourly_rate: i64,
    pub payment: Option<Payment>,
    pub exited_at_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdmissionInput {
    pub license_plate: String,
    pub entry_at_ms: i64,
    pub planned_exit_at_ms: Option<i64>,
    pub tariff_mode: TariffMode,
    pub hourly_rate: i64,
}

pub fn calculate_amount(entry: i64, exit: i64, rate: i64) -> Result<i64> {
    let duration = exit
        .checked_sub(entry)
        .ok_or_else(|| error("validation", "Некорректное время"))?;
    if entry < 0
        || duration <= 0
        || duration > 366 * 24 * 3_600_000
        || !(1..=1_000_000).contains(&rate)
    {
        return Err(error("validation", "Выезд должен быть позже въезда, стоянка — не дольше 366 дней, тариф — от 1 до 1 000 000 ₸/ч"));
    }
    Ok(((duration + 3_599_999) / 3_600_000) * rate)
}

impl AdmissionInput {
    fn validate(mut self) -> Result<Self> {
        self.license_plate = self.license_plate.trim().to_uppercase();
        if self.license_plate.is_empty() || self.license_plate.chars().count() > 20 {
            return Err(error(
                "validation",
                "Госномер должен содержать от 1 до 20 символов",
            ));
        }
        if self.entry_at_ms > DateTime::now().timestamp_millis() {
            return Err(error(
                "validation",
                "Время фактического въезда не может быть в будущем",
            ));
        }
        match (&self.tariff_mode, self.planned_exit_at_ms) {
            (TariffMode::Planned, Some(exit)) => {
                calculate_amount(self.entry_at_ms, exit, self.hourly_rate)?;
            }
            (TariffMode::Open, None) => {
                calculate_amount(
                    self.entry_at_ms,
                    self.entry_at_ms.saturating_add(1),
                    self.hourly_rate,
                )?;
            }
            _ => {
                return Err(error(
                    "validation",
                    "Укажите срок для тарифа по времени; для открытого тарифа срок не задаётся",
                ))
            }
        }
        Ok(self)
    }
}

impl ParkingDb {
    pub async fn admit(&self, id: &str, input: AdmissionInput) -> Result<SpotDto> {
        let input = input.validate()?;
        let spot = self.get(id).await?;
        // Старое занятое место без сессии можно оформить только на прежний госномер.
        if spot.data.status == SpotStatus::Maintenance
            || spot.active_visit.is_some()
            || (spot.data.status == SpotStatus::Occupied
                && spot.data.license_plate.as_deref() != Some(&input.license_plate))
        {
            return Err(error("conflict", "Место недоступно для приёма автомобиля"));
        }
        let visit = Visit {
            id: ObjectId::new().to_hex(),
            license_plate: input.license_plate.clone(),
            entry_at_ms: input.entry_at_ms,
            planned_exit_at_ms: input.planned_exit_at_ms,
            tariff_mode: input.tariff_mode,
            hourly_rate: input.hourly_rate,
            payment: None,
            exited_at_ms: None,
        };
        self.spots.find_one_and_update(doc! { "_id": object_id(id)?, "active_visit": null,
            "status": to_bson(&spot.data.status).unwrap(), "license_plate": &spot.data.license_plate },
            doc! { "$set": { "active_visit": to_bson(&visit).unwrap(), "status": "occupied", "license_plate": input.license_plate, "updated_at": DateTime::now() } })
            .return_document(ReturnDocument::After).await?.map(Into::into)
            .ok_or_else(|| error("conflict", "Место уже изменено другим оператором. Обновите данные"))
    }

    pub async fn revise_visit(
        &self,
        id: &str,
        visit_id: &str,
        input: AdmissionInput,
    ) -> Result<SpotDto> {
        let input = input.validate()?;
        self.spots.find_one_and_update(doc! { "_id": object_id(id)?, "active_visit.id": visit_id, "active_visit.payment": null },
            doc! { "$set": { "license_plate": &input.license_plate, "active_visit.license_plate": input.license_plate,
                "active_visit.entry_at_ms": input.entry_at_ms, "active_visit.planned_exit_at_ms": input.planned_exit_at_ms,
                "active_visit.tariff_mode": to_bson(&input.tariff_mode).unwrap(), "active_visit.hourly_rate": input.hourly_rate, "updated_at": DateTime::now() } })
            .return_document(ReturnDocument::After).await?.map(Into::into)
            .ok_or_else(|| error("conflict", "Стоянка уже оплачена или изменена. Обновите данные"))
    }

    pub async fn pay(
        &self,
        id: &str,
        visit_id: &str,
        departure: i64,
        method: PaymentMethod,
        expected_amount: i64,
        split: Option<PaymentSplit>,
    ) -> Result<SpotDto> {
        let spot = self.get(id).await?;
        let visit = spot
            .active_visit
            .ok_or_else(|| error("conflict", "Нет активной стоянки"))?;
        if visit.id != visit_id || visit.payment.is_some() {
            return Err(error("conflict", "Стоянка уже оплачена или изменена"));
        }
        if visit.tariff_mode == TariffMode::Open && departure > DateTime::now().timestamp_millis() {
            return Err(error(
                "validation",
                "Время фактического выезда не может быть в будущем",
            ));
        }
        let departure = if visit.tariff_mode == TariffMode::Planned {
            visit
                .planned_exit_at_ms
                .ok_or_else(|| error("validation", "Не задан срок стоянки"))?
        } else {
            departure
        };
        let amount = calculate_amount(visit.entry_at_ms, departure, visit.hourly_rate)?;
        if amount != expected_amount {
            return Err(error(
                "conflict",
                "Сумма изменилась. Обновите данные и проверьте расчёт",
            ));
        }
        let (cash_amount, card_amount) = method.validate_split(amount, split)?;
        let payment = Payment {
            method,
            amount,
            departure_at_ms: departure,
            paid_at_ms: DateTime::now().timestamp_millis(),
            cash_amount: Some(cash_amount),
            card_amount: Some(card_amount),
        };
        // Проверка тарифа и времени в фильтре защищает от одновременного редактирования.
        self.spots.find_one_and_update(doc! { "_id": object_id(id)?, "active_visit.id": visit_id, "active_visit.payment": null,
            "active_visit.entry_at_ms": visit.entry_at_ms, "active_visit.hourly_rate": visit.hourly_rate,
            "active_visit.planned_exit_at_ms": visit.planned_exit_at_ms, "active_visit.tariff_mode": to_bson(&visit.tariff_mode).unwrap(), "active_visit.license_plate": visit.license_plate },
            doc! { "$set": { "active_visit.payment": to_bson(&payment).unwrap(), "updated_at": DateTime::now() } })
            .return_document(ReturnDocument::After).await?.map(Into::into)
            .ok_or_else(|| error("conflict", "Оплата уже отмечена или данные изменились. Обновите карточку"))
    }

    pub async fn checkout(&self, id: &str, visit_id: &str) -> Result<SpotDto> {
        let spot = self.get(id).await?;
        let mut visit = spot
            .active_visit
            .clone()
            .ok_or_else(|| error("conflict", "Нет активной стоянки"))?;
        if visit.id != visit_id {
            return Err(error("conflict", "Стоянка изменилась. Обновите карточку"));
        }
        let payment = visit
            .payment
            .as_ref()
            .ok_or_else(|| error("conflict", "Сначала отметьте оплату"))?;
        visit.exited_at_ms = Some(if visit.tariff_mode == TariffMode::Open {
            payment.departure_at_ms
        } else {
            DateTime::now().timestamp_millis()
        });
        self.archive_visit(&crate::history::CompletedVisit::new(&spot, visit))
            .await?;
        self.release_archived(id, visit_id).await?;
        self.get(id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hourly_rounding() {
        assert_eq!(PaymentMethod::Mixed.split(1000), (500, 500));
        assert_eq!(PaymentMethod::Mixed.split(501), (250, 251));
        assert_eq!(PaymentMethod::Cash.split(501), (501, 0));
        assert_eq!(PaymentMethod::Card.split(501), (0, 501));
        assert_eq!(calculate_amount(0, 1, 500).unwrap(), 500);
        assert_eq!(calculate_amount(0, 3_600_000, 500).unwrap(), 500);
        assert_eq!(calculate_amount(0, 3_600_001, 500).unwrap(), 1000);
        assert!(calculate_amount(10, 10, 500).is_err());
        assert!(calculate_amount(10, 9, 500).is_err());
        assert!(calculate_amount(0, 1, 0).is_err());
        assert!(calculate_amount(0, i64::MAX, 500).is_err());
    }
    #[test]
    fn mixed_payment_requires_exact_positive_split() {
        let split = |cash_amount, card_amount| {
            Some(PaymentSplit {
                cash_amount,
                card_amount,
            })
        };
        assert_eq!(
            PaymentMethod::Mixed
                .validate_split(1400, split(300, 1100))
                .unwrap(),
            (300, 1100)
        );
        for (cash, card) in [
            (300, 1000),
            (300, 1200),
            (0, 1400),
            (-100, 1500),
            (i64::MAX, 1),
        ] {
            assert!(PaymentMethod::Mixed
                .validate_split(1400, split(cash, card))
                .is_err());
        }
        assert!(PaymentMethod::Mixed.validate_split(1400, None).is_err());
        assert!(PaymentMethod::Cash
            .validate_split(1400, split(300, 1100))
            .is_err());
        assert_eq!(
            PaymentMethod::Cash.validate_split(1400, None).unwrap(),
            (1400, 0)
        );
        assert_eq!(
            PaymentMethod::Card.validate_split(1400, None).unwrap(),
            (0, 1400)
        );
    }

    #[tokio::test]
    #[ignore = "Requires local MongoDB; isolated temporary database"]
    async fn visit_lifecycle() {
        use crate::parking::{SpotInput, VehicleType};
        use mongodb::Client;
        let uri =
            std::env::var("MONGODB_URI").unwrap_or_else(|_| "mongodb://127.0.0.1:27017".into());
        let name = format!("carspot_test_{}", ObjectId::new().to_hex());
        let db = ParkingDb::connect(&uri, &name).await.unwrap();
        let base = SpotInput {
            number: "TEST".into(),
            vehicle_type: VehicleType::Car,
            status: SpotStatus::Available,
            license_plate: None,
        };
        let spot = db.create(base.clone()).await.unwrap();
        let now = DateTime::now().timestamp_millis();
        let admission = || AdmissionInput {
            license_plate: " test123 ".into(),
            entry_at_ms: now - 3_600_001,
            planned_exit_at_ms: None,
            tariff_mode: TariffMode::Open,
            hourly_rate: 500,
        };
        let (first, second) = tokio::join!(
            db.admit(&spot.id, admission()),
            db.admit(&spot.id, admission())
        );
        assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
        let current = db.get(&spot.id).await.unwrap();
        let visit_id = current.active_visit.unwrap().id;
        let other = db
            .create(SpotInput {
                number: "OTHER".into(),
                ..base.clone()
            })
            .await
            .unwrap();
        assert_eq!(
            db.admit(&other.id, admission()).await.unwrap_err().code,
            "conflict"
        );
        assert!(db.update(&spot.id, base.clone()).await.is_err());
        assert!(db.checkout(&spot.id, &visit_id).await.is_err());
        assert!(db
            .pay(&spot.id, &visit_id, now, PaymentMethod::Cash, 500, None)
            .await
            .is_err());
        let (a, b) = tokio::join!(
            db.pay(&spot.id, &visit_id, now, PaymentMethod::Cash, 1000, None),
            db.pay(&spot.id, &visit_id, now, PaymentMethod::Card, 1000, None)
        );
        assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
        assert!(db
            .revise_visit(&spot.id, &visit_id, admission())
            .await
            .is_err());
        let completed = db.checkout(&spot.id, &visit_id).await.unwrap();
        assert_eq!(completed.data.status, SpotStatus::Available);
        assert!(completed.active_visit.is_none());
        assert_eq!(
            db.list_completed(None, 200).await.unwrap()[0]
                .visit
                .payment
                .as_ref()
                .unwrap()
                .amount,
            1000
        );
        assert!(db.checkout(&spot.id, &visit_id).await.is_err());
        let next = db.admit(&spot.id, admission()).await.unwrap();
        assert!(db
            .pay(&spot.id, &visit_id, now, PaymentMethod::Cash, 1000, None)
            .await
            .is_err());
        let next_id = next.active_visit.unwrap().id;
        let planned = AdmissionInput {
            license_plate: "TEST123".into(),
            entry_at_ms: now - 3_600_000,
            planned_exit_at_ms: Some(now + 3_600_000),
            tariff_mode: TariffMode::Planned,
            hourly_rate: 700,
        };
        db.revise_visit(&spot.id, &next_id, planned).await.unwrap();
        db.pay(
            &spot.id,
            &next_id,
            now,
            PaymentMethod::Mixed,
            1400,
            Some(PaymentSplit {
                cash_amount: 300,
                card_amount: 1100,
            }),
        )
        .await
        .unwrap();
        let reopened = ParkingDb::connect(&uri, &name).await.unwrap();
        let saved = reopened.get(&spot.id).await.unwrap().active_visit.unwrap();
        let payment = saved.payment.unwrap();
        assert_eq!(payment.amount, 1400);
        assert!(matches!(payment.method, PaymentMethod::Mixed));
        assert_eq!(payment.cash_amount, Some(300));
        assert_eq!(payment.card_amount, Some(1100));
        reopened.checkout(&spot.id, &next_id).await.unwrap();
        let history = reopened.list_completed(None, 200).await.unwrap();
        assert_eq!(history.len(), 2);
        let done = &history
            .iter()
            .find(|r| r.visit.id == next_id)
            .unwrap()
            .visit;
        assert!(done.exited_at_ms.unwrap() <= DateTime::now().timestamp_millis());
        assert_eq!(done.tariff_mode, TariffMode::Planned);
        Client::with_uri_str(&uri)
            .await
            .unwrap()
            .database(&name)
            .drop()
            .await
            .unwrap();
    }
}
