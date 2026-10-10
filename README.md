# CarSpot

Десктоп-приложение: React + TypeScript, Tauri 2, Rust и MongoDB.
Первый этап — CRUD парковочных мест. Формы оператора, талоны, история
въездов/выездов, тарифы, оплата и отчёты пока не реализованы.

## Подключение и запуск

Нужен работающий **MongoDB Server**. Compass — клиент для просмотра этой же базы.
По умолчанию Rust подключается к `mongodb://127.0.0.1:27017`, база `CarSpot`,
коллекция `parking_spots`. В Compass используйте этот адрес и обновите список баз.

```powershell
npm run db:seed
npm run tauri dev
```

`db:seed` создаёт 50 свободных мест: `A-001`–`A-040` для легковых автомобилей,
`M-001`–`M-005` для мотоциклов, `T-001`–`T-005` для грузовиков.
Используется `$setOnInsert`: существующие записи не перезаписываются. Повторный
запуск добавляет только отсутствующие номера, в том числе ранее удалённые.
При обычном запуске приложения заполнение автоматически не выполняется.

Для другого подключения задайте переменные в терминале перед запуском:

```powershell
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017'
$env:MONGODB_DATABASE = 'CarSpot'
```

`.env` автоматически не читается. URI хранится только на стороне Rust;
не помещайте учётные данные в переменные `VITE_*` или исходники React.
Подключение ленивое, общее для команд. После неудачного подключения следующий
вызов повторяет попытку. При недоступности сервера возвращается ошибка `database`.

Если команда `npm` сообщает, что не найден `npm-cli.js` в AppData, можно
использовать установленный npm напрямую:

```powershell
& 'C:/Program Files/nodejs/npm.cmd' run db:seed
& 'C:/Program Files/nodejs/npm.cmd' run tauri dev
```

## API для React

Типизированные функции находятся в `src/api/parking.ts` и используют Tauri IPC,
а не HTTP. Они работают в десктоп-приложении; одного `npm run dev` недостаточно.

```typescript
import { parkingApi } from './api/parking';

const created = await parkingApi.create({
  number: 'A-041',
  vehicle_type: 'car', // car | motorcycle | truck
  status: 'available', // available | occupied | maintenance
  license_plate: null,
});
const page = await parkingApi.list(null, 0, 100);
const free = await parkingApi.list('available');
const spot = await parkingApi.get(created.id);
await parkingApi.update(spot.id, {
  number: spot.number,
  vehicle_type: spot.vehicle_type,
  status: 'occupied',
  license_plate: '123ABC01',
});
// Перед удалением освободить место:
await parkingApi.update(spot.id, {
  number: spot.number,
  vehicle_type: spot.vehicle_type,
  status: 'available',
  license_plate: null,
});
await parkingApi.delete(spot.id);
```

Команды: `list_parking_spots`, `get_parking_spot`, `create_parking_spot`,
`update_parking_spot`, `delete_parking_spot`, `seed_parking_spots`.
Обновление принимает все поля `SpotInput`; `id` передаётся отдельно.
Список сортируется по номеру, поддерживает фильтр состояния, смещение и размер
страницы 1–200 (по умолчанию 100). Идентификаторы в API — строки ObjectId,
временные отметки — миллисекунды Unix; в MongoDB хранятся BSON ObjectId и Date.

Номера обрезаются по краям и приводятся к верхнему регистру. Номер места
уникален; один госномер может занимать только одно место. Для занятого места
госномер обязателен, для остальных состояний должен быть `null`.
Занятые места защищены от удаления атомарным фильтром MongoDB.
Ошибки отклоняют Promise объектом `{ code, message }`: `validation`,
`not_found`, `conflict`, `configuration`, `database`.

Это административный CRUD: при одновременном редактировании одной записи
сохраняется последнее обновление. Регистрация въезда с конкурентным назначением
свободного места и финансовый учёт требуют отдельного слоя бизнес-операций.
Официальная документация драйвера: https://www.mongodb.com/docs/drivers/rust/current/.

## Проверки

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored
```

Последняя команда требует MongoDB. Она создаёт отдельную базу
`carspot_test_<ObjectId>`, проверяет CRUD, индексы, защиту занятого места и
повторное заполнение, затем удаляет только эту тестовую базу. Рабочая база
не затрагивается. При аварийном завершении тестовая база может остаться.
