import * as SQLite from 'expo-sqlite';

export interface Trip {
  id:            number;
  bus_id:        string;
  boarded_at:    number;   // ms timestamp
  deboarded_at:  number | null;
  board_lat:     number | null;
  board_lng:     number | null;
  deboard_lat:   number | null;
  deboard_lng:   number | null;
  duration_secs: number | null;
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
    `INSERT INTO trips (bus_id, boarded_at, board_lat, board_lng)
     VALUES (?, ?, ?, ?)`,
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
  const duration = await d.getFirstAsync<{ boarded_at: number }>(
    `SELECT boarded_at FROM trips WHERE id = ?`, [tripId],
  );
  const secs = duration ? Math.round((deboardedAt - duration.boarded_at) / 1000) : null;
  await d.runAsync(
    `UPDATE trips
     SET deboarded_at = ?, deboard_lat = ?, deboard_lng = ?, duration_secs = ?
     WHERE id = ?`,
    [deboardedAt, lat, lng, secs, tripId],
  );
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
}
