import * as SQLite from 'expo-sqlite';

export interface Trip {
  id:            number;
  bus_id:        string;
  boarded_at:    number;
  deboarded_at:  number | null;
  board_lat:     number | null;
  board_lng:     number | null;
  deboard_lat:   number | null;
  deboard_lng:   number | null;
  duration_secs: number | null;
}

export interface Breadcrumb {
  lat:         number;
  lng:         number;
  recorded_at: number;
}

let _db: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = await SQLite.openDatabaseAsync('blebus.db');
    await _db.execAsync(`
      CREATE TABLE IF NOT EXISTS trips (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        bus_id        TEXT    NOT NULL,
        boarded_at    INTEGER NOT NULL,
        deboarded_at  INTEGER,
        board_lat     REAL,
        board_lng     REAL,
        deboard_lat   REAL,
        deboard_lng   REAL,
        duration_secs INTEGER
      );
      CREATE TABLE IF NOT EXISTS trip_coords (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id     INTEGER NOT NULL,
        lat         REAL    NOT NULL,
        lng         REAL    NOT NULL,
        recorded_at INTEGER NOT NULL
      );
    `);
  }
  return _db;
}

export async function insertBoarding(
  busId: string,
  boardedAt: number,
  lat: number | null,
  lng: number | null,
): Promise<number> {
  const d = await db();
  const result = await d.runAsync(
    `INSERT INTO trips (bus_id, boarded_at, board_lat, board_lng) VALUES (?, ?, ?, ?)`,
    [busId, boardedAt, lat, lng],
  );
  return result.lastInsertRowId;
}

export async function updateDeboarding(
  tripId: number,
  deboardedAt: number,
  lat: number | null,
  lng: number | null,
): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<{ boarded_at: number }>(
    `SELECT boarded_at FROM trips WHERE id = ?`, [tripId],
  );
  const secs = row ? Math.round((deboardedAt - row.boarded_at) / 1000) : null;
  await d.runAsync(
    `UPDATE trips SET deboarded_at = ?, deboard_lat = ?, deboard_lng = ?, duration_secs = ? WHERE id = ?`,
    [deboardedAt, lat, lng, secs, tripId],
  );
}

export async function insertBreadcrumb(
  tripId: number,
  lat: number,
  lng: number,
): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO trip_coords (trip_id, lat, lng, recorded_at) VALUES (?, ?, ?, ?)`,
    [tripId, lat, lng, Date.now()],
  );
}

export async function fetchBreadcrumbs(tripId: number): Promise<Breadcrumb[]> {
  const d = await db();
  return d.getAllAsync<Breadcrumb>(
    `SELECT lat, lng, recorded_at FROM trip_coords WHERE trip_id = ? ORDER BY recorded_at ASC`,
    [tripId],
  );
}

export async function findTripByBoardedAt(boardedAt: number): Promise<number | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ id: number }>(
    `SELECT id FROM trips WHERE boarded_at = ? AND deboarded_at IS NULL LIMIT 1`,
    [boardedAt],
  );
  return row?.id ?? null;
}

export async function fetchTrip(tripId: number): Promise<Trip | null> {
  const d = await db();
  return d.getFirstAsync<Trip>(`SELECT * FROM trips WHERE id = ?`, [tripId]) ?? null;
}

export async function fetchTrips(limit = 50): Promise<Trip[]> {
  const d = await db();
  return d.getAllAsync<Trip>(
    `SELECT * FROM trips ORDER BY boarded_at DESC LIMIT ?`, [limit],
  );
}

export async function clearTrips(): Promise<void> {
  const d = await db();
  await d.runAsync(`DELETE FROM trips`);
  await d.runAsync(`DELETE FROM trip_coords`);
}
