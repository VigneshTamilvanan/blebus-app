package `in`.nammayatri.blebus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat

class BLEDetectionService : Service() {

    companion object {
        const val EXTRA_CUSTOM_NAMES = "customNames"

        @Volatile
        var onDetection: ((result: Map<String, Any?>, rawScans: List<Map<String, Any>>) -> Unit)? = null

        // Cached so BLEModule can emit the current state immediately on app reopen.
        @Volatile var lastResult: Map<String, Any?>? = null
        @Volatile var lastRawScans: List<Map<String, Any>> = emptyList()

        // Reverse-direction callbacks: called by BLEModule when the user acts on UI prompts.
        @Volatile var onSelectBus: ((String) -> Unit)? = null
        @Volatile var onConfirmDeboard: (() -> Unit)? = null
        @Volatile var onCancelDeboard: (() -> Unit)? = null

        private const val COMPANY_ID       = 0xFFFF
        private const val TX_POWER_1M      = -90.0  // ESP32-D0WD-V3 +9dBm, measured -90 at 1m
        private const val PATH_LOSS_N      = 2.5
        private const val NOISE_FLOOR      = -115   // pre-filter; below BLE noise floor
        private const val STRONG_THRESHOLD = -105.0 // ~4m detection range at this antenna
        private const val STABILITY_MS     = 6_000L
        private const val EXIT_RSSI        = -109.0 // exit when signal equiv. to ~6m
        private const val EXIT_MS          = 5_000L
        private const val STALE_MS         = 6_000L
        private const val ROLLING_WINDOW   = 5
        private const val TREND_WINDOW     = 6
        private const val TREND_SLOPE_DB   = 0.4
        private const val PASSING_BUS_MS      = 4_000L
        private const val MAX_VARIANCE       = 15.0   // relaxed: lower RSSI = noisier readings
        private const val AMBIGUOUS_MARGIN   = 8.0    // dBm — two buses within this = ask user
        private const val PENDING_DEBOARD_MS = 30_000L // auto-deboard after 30s if no response
        private const val NOTIF_CHANNEL    = "ble-detection"
        private const val FG_NOTIF_ID      = 42
        private const val BOARD_NOTIF_ID   = 43
        private const val DEBOARD_NOTIF_ID = 44
        private const val PREFS_NAME       = "ble_state"
        private const val PKEY_STATE       = "state"
        private const val PKEY_BUS         = "confirmedBus"
        private const val PKEY_BOARDED_AT  = "boardedAtMs"
    }

    // ── State machine ─────────────────────────────────────────────────────────

    private enum class State { SCANNING, CANDIDATE, AMBIGUOUS, CONFIRMED, PENDING_DEBOARD, LOST }

    private class BeaconTrack(var firstSeen: Long) {
        var recedingSince: Long? = null
        val rssiHistory = mutableListOf<Double>()
    }

    private var state                  = State.SCANNING
    private var confirmedBus: String?  = null
    private var lostSince: Long?       = null
    private var boardedAtMs: Long?     = null
    private var pendingDeboardSince: Long? = null
    private var ambiguousCandidates: List<String> = emptyList()
    private val tracks                 = mutableMapOf<String, BeaconTrack>()
    private val confirmedHistory       = mutableListOf<Double>()
    private var lastNotifiedState      = "scanning"

    // ── BLE book-keeping (all accessed only on handlerThread) ─────────────────

    private data class BeaconData(val busId: String, val isBus: Boolean, val rawRssi: Int, val avgRssi: Double)

    private val latest      = mutableMapOf<String, BeaconData>()
    private val lastSeen    = mutableMapOf<String, Long>()
    private val rssiBuffers = mutableMapOf<String, MutableList<Double>>()

    // ── Threading ─────────────────────────────────────────────────────────────

    private val handlerThread = HandlerThread("BLEDetectionThread").apply { start() }
    private val handler       = Handler(handlerThread.looper)

    private val tickRunnable = object : Runnable {
        override fun run() {
            tick()
            handler.postDelayed(this, 1_000)
        }
    }

    private var customNames = listOf<String>()
    private var started     = false   // prevents duplicate scan/tick on repeated onStartCommand

    // ── BLE scan callback (delivers on a Binder thread → post to handler) ─────

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            handler.post { onDevice(result) }
        }
        override fun onBatchScanResults(results: MutableList<ScanResult>) {
            handler.post { results.forEach { onDevice(it) } }
        }
        override fun onScanFailed(errorCode: Int) {
            handler.postDelayed({ startBLEScan() }, 3_000)
        }
    }

    // ── Service lifecycle ─────────────────────────────────────────────────────

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.getStringArrayListExtra(EXTRA_CUSTOM_NAMES)?.let { customNames = it }
        startForeground(FG_NOTIF_ID, buildForegroundNotification())
        if (!started) {
            started = true
            restoreState()
            onSelectBus      = { busId -> handler.post { doSelectBus(busId) } }
            onConfirmDeboard = { handler.post { doConfirmDeboard() } }
            onCancelDeboard  = { handler.post { doCancelDeboard() } }
            startBLEScan()
            handler.post(tickRunnable)
        }
        return START_STICKY
    }

    // ── State persistence (survives process death / MIUI kill) ────────────────

    private val prefs by lazy { getSharedPreferences(PREFS_NAME, MODE_PRIVATE) }

    private fun persistState() {
        // PENDING_DEBOARD saves as CONFIRMED so reopen shows boarded while user decides.
        // AMBIGUOUS saves as SCANNING — user hasn't confirmed boarding yet.
        val saved = when (state) {
            State.PENDING_DEBOARD -> State.CONFIRMED.name
            State.AMBIGUOUS       -> State.SCANNING.name
            else                  -> state.name
        }
        prefs.edit()
            .putString(PKEY_STATE, saved)
            .putString(PKEY_BUS,   confirmedBus)
            .putLong(PKEY_BOARDED_AT, boardedAtMs ?: -1L)
            .apply()
    }

    private fun clearPersistedState() {
        prefs.edit().clear().apply()
    }

    private fun restoreState() {
        val savedStateName = prefs.getString(PKEY_STATE, null) ?: return
        if (savedStateName != State.CONFIRMED.name) { clearPersistedState(); return }
        val bus = prefs.getString(PKEY_BUS, null) ?: return
        val bms = prefs.getLong(PKEY_BOARDED_AT, -1L).takeIf { it > 0L } ?: return

        state        = State.CONFIRMED
        confirmedBus = bus
        boardedAtMs  = bms

        // Pre-populate companion cache so BLEModule emits confirmed state the
        // instant the app opens, before the first scan tick completes.
        lastResult = mapOf(
            "busId" to bus, "state" to "confirmed", "confidence" to 1.0,
            "rawRssi" to -90, "avgRssi" to -90.0,
            "distanceM" to 1.0, "distanceScore" to 0.8,
            "trend" to "stable", "boardedAtMs" to bms
        )
    }

    override fun onDestroy() {
        onSelectBus = null; onConfirmDeboard = null; onCancelDeboard = null
        handler.removeCallbacksAndMessages(null)
        try {
            (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
                .adapter?.bluetoothLeScanner?.stopScan(scanCallback)
        } catch (_: Exception) {}
        handlerThread.quitSafely()
        super.onDestroy()
    }

    // ── BLE scanning ──────────────────────────────────────────────────────────

    private fun startBLEScan() {
        val adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        if (adapter == null || !adapter.isEnabled) {
            handler.postDelayed({ startBLEScan() }, 5_000); return
        }
        val bleScanner = adapter.bluetoothLeScanner
        if (bleScanner == null) {
            handler.postDelayed({ startBLEScan() }, 5_000); return
        }
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        try {
            bleScanner.startScan(null, settings, scanCallback)
        } catch (_: Exception) {
            handler.postDelayed({ startBLEScan() }, 3_000)
        }
    }

    // Called on handlerThread
    private fun onDevice(result: ScanResult) {
        if (result.rssi < NOISE_FLOOR) return
        val parsed = parseBusId(result) ?: return
        val (busId, isBus) = parsed

        val buf = rssiBuffers.getOrPut(busId) { mutableListOf() }
        buf.add(result.rssi.toDouble())
        if (buf.size > ROLLING_WINDOW) buf.removeAt(0)
        val avg = buf.average()

        lastSeen[busId] = SystemClock.elapsedRealtime()
        latest[busId]   = BeaconData(busId, isBus, result.rssi, avg)
    }

    private fun parseBusId(result: ScanResult): Pair<String, Boolean>? {
        val record = result.scanRecord ?: return null

        val mfrData = record.manufacturerSpecificData
        if (mfrData != null) {
            for (i in 0 until mfrData.size()) {
                if (mfrData.keyAt(i) == COMPANY_ID) {
                    val busId = String(mfrData.valueAt(i)).trimEnd(' ').trim()
                    if (busId.isNotEmpty()) return Pair(busId, true)
                }
            }
        }

        val name = record.deviceName ?: result.device?.name
        if (!name.isNullOrEmpty()) {
            if (name.startsWith("NY-BUS-")) return Pair(name, true)
            if (customNames.contains(name)) return Pair(name, false)
        }
        return null
    }

    // ── 1-second tick (runs on handlerThread) ─────────────────────────────────

    private fun tick() {
        val now = SystemClock.elapsedRealtime()

        // Expire stale beacons
        val stale = lastSeen.entries.filter { now - it.value > STALE_MS }.map { it.key }
        stale.forEach { id -> latest.remove(id); lastSeen.remove(id); rssiBuffers.remove(id) }

        // Build active scan list (bus-only if any bus present)
        val all    = latest.values.toList()
        val hasBus = all.any { it.isBus }
        val scans  = if (hasBus) all.filter { it.isBus } else all

        val result = when (state) {
            State.SCANNING, State.CANDIDATE -> handleSearching(scans, now)
            State.AMBIGUOUS                 -> handleAmbiguous(scans, now)
            State.CONFIRMED                 -> handleConfirmed(scans, now)
            State.PENDING_DEBOARD           -> handlePendingDeboard(scans, now)
            State.LOST                      -> handleLost(scans, now)
        }

        val newState = result["state"] as String
        fireNotifications(lastNotifiedState, newState, result["busId"] as? String)
        lastNotifiedState = newState

        val rawScansMap = latest.values.map { b ->
            mapOf<String, Any>("busId" to b.busId, "isBus" to b.isBus,
                "rawRssi" to b.rawRssi, "avgRssi" to b.avgRssi)
        }
        lastResult   = result
        lastRawScans = rawScansMap
        persistState()
        onDetection?.invoke(result, rawScansMap)
    }

    // ── Detection state machine ───────────────────────────────────────────────

    private fun handleSearching(scans: List<BeaconData>, now: Long): Map<String, Any?> {
        val aboveFloor = scans.filter { it.avgRssi > STRONG_THRESHOLD }
        val busOnly    = aboveFloor.filter { it.isBus }
        val active     = if (busOnly.isNotEmpty()) busOnly else aboveFloor

        if (active.isEmpty()) {
            tracks.clear(); state = State.SCANNING; return idle()
        }

        tracks.keys.retainAll(active.map { it.busId }.toSet())

        val surviving = mutableListOf<BeaconData>()
        for (beacon in active) {
            val track = tracks.getOrPut(beacon.busId) { BeaconTrack(now) }
            track.rssiHistory.add(beacon.avgRssi)
            if (track.rssiHistory.size > TREND_WINDOW) track.rssiHistory.removeAt(0)

            val trend = toTrend(rssiSlope(track.rssiHistory))
            if (trend == "receding") {
                if (track.recedingSince == null) track.recedingSince = now
                if (now - track.recedingSince!! >= PASSING_BUS_MS) {
                    tracks.remove(beacon.busId); continue
                }
            } else {
                track.recedingSince = null
            }
            surviving.add(beacon)
        }

        if (surviving.isEmpty()) { state = State.SCANNING; return idle() }

        surviving.sortWith { a, b ->
            val ea = now - (tracks[a.busId]?.firstSeen ?: now)
            val eb = now - (tracks[b.busId]?.firstSeen ?: now)
            if (Math.abs(ea - eb) > 2_000) (eb - ea).toInt()
            else (b.avgRssi - a.avgRssi).toInt()
        }

        val best    = surviving[0]
        val track   = tracks[best.busId]!!
        val elapsed = now - track.firstSeen
        val trend   = toTrend(rssiSlope(track.rssiHistory))
        val dist    = rssiToDistance(best.avgRssi)
        val dscore  = distanceToScore(dist)
        val conf    = confidence(dscore, elapsed)

        if (elapsed >= STABILITY_MS) {
            // Check for ambiguous: second bus also stable and within AMBIGUOUS_MARGIN
            if (surviving.size >= 2) {
                val second = surviving[1]
                val secondElapsed = now - (tracks[second.busId]?.firstSeen ?: now)
                if (secondElapsed >= STABILITY_MS &&
                    Math.abs(best.avgRssi - second.avgRssi) <= AMBIGUOUS_MARGIN) {
                    state = State.AMBIGUOUS
                    ambiguousCandidates = listOf(best.busId, second.busId)
                    return detection(null, "ambiguous", 0.0, 0, 0.0, 0.0, 0.0, "stable", ambiguousCandidates)
                }
            }

            val variance = rssiVariance(track.rssiHistory)
            if (variance <= MAX_VARIANCE) {
                state        = State.CONFIRMED
                confirmedBus = best.busId
                boardedAtMs  = System.currentTimeMillis()
                confirmedHistory.clear(); confirmedHistory.addAll(track.rssiHistory)
                lostSince = null; tracks.clear()
                return detection(best.busId, "confirmed", conf, best.rawRssi, best.avgRssi, dist, dscore, trend)
            }
            // Signal too noisy — reset candidate timer
            track.firstSeen = now
        }

        state = State.CANDIDATE
        return detection(best.busId, "candidate", conf, best.rawRssi, best.avgRssi, dist, dscore, trend)
    }

    private fun handleConfirmed(scans: List<BeaconData>, now: Long): Map<String, Any?> {
        val confirmed = confirmedBus ?: return run { state = State.SCANNING; idle() }
        val cur = scans.find { it.busId == confirmed }

        if (cur == null || cur.avgRssi < EXIT_RSSI) {
            if (lostSince == null) lostSince = now
            if (now - lostSince!! >= EXIT_MS) {
                state = State.PENDING_DEBOARD
                pendingDeboardSince = now
                lostSince = null
                val raw = cur?.rawRssi ?: -99
                val avg = cur?.avgRssi ?: -99.0
                return detection(confirmed, "pendingDeboard", 0.0, raw, avg, rssiToDistance(avg), 0.0, "receding")
            }
        } else {
            lostSince = null
        }

        if (cur == null) {
            return detection(confirmed, "confirmed", 0.0, -99, -99.0, 99.0, 0.0, "receding")
        }

        confirmedHistory.add(cur.avgRssi)
        if (confirmedHistory.size > TREND_WINDOW) confirmedHistory.removeAt(0)
        val trend  = toTrend(rssiSlope(confirmedHistory))
        val dist   = rssiToDistance(cur.avgRssi)
        val dscore = distanceToScore(dist)
        val conf   = confidence(dscore, STABILITY_MS)
        return detection(confirmed, "confirmed", conf, cur.rawRssi, cur.avgRssi, dist, dscore, trend)
    }

    private fun handleAmbiguous(scans: List<BeaconData>, now: Long): Map<String, Any?> {
        val visible = ambiguousCandidates.filter { id ->
            scans.any { it.busId == id && it.avgRssi > STRONG_THRESHOLD }
        }
        if (visible.isEmpty()) {
            ambiguousCandidates = emptyList(); state = State.SCANNING; return idle()
        }
        // If one candidate dropped out, auto-select the remaining one
        if (visible.size == 1) {
            doSelectBus(visible[0])
            val beacon = scans.find { it.busId == visible[0] } ?: return idle()
            val dist = rssiToDistance(beacon.avgRssi)
            val dscore = distanceToScore(dist)
            return detection(visible[0], "confirmed", confidence(dscore, STABILITY_MS),
                beacon.rawRssi, beacon.avgRssi, dist, dscore, "stable")
        }
        return detection(null, "ambiguous", 0.0, 0, 0.0, 0.0, 0.0, "stable", ambiguousCandidates)
    }

    private fun handlePendingDeboard(scans: List<BeaconData>, now: Long): Map<String, Any?> {
        val confirmed = confirmedBus ?: run { state = State.SCANNING; return idle() }
        val cur = scans.find { it.busId == confirmed }

        // Signal came back — cancel deboard
        if (cur != null && cur.avgRssi >= EXIT_RSSI) {
            state = State.CONFIRMED; pendingDeboardSince = null; lostSince = null
            val dist = rssiToDistance(cur.avgRssi); val dscore = distanceToScore(dist)
            confirmedHistory.add(cur.avgRssi)
            if (confirmedHistory.size > TREND_WINDOW) confirmedHistory.removeAt(0)
            return detection(confirmed, "confirmed", confidence(dscore, STABILITY_MS),
                cur.rawRssi, cur.avgRssi, dist, dscore, toTrend(rssiSlope(confirmedHistory)))
        }

        // Auto-deboard after timeout
        if (pendingDeboardSince != null && now - pendingDeboardSince!! >= PENDING_DEBOARD_MS) {
            doConfirmDeboard(); return detection(confirmed, "lost", 0.0, -99, -99.0, 99.0, 0.0, "receding")
        }

        return detection(confirmed, "pendingDeboard", 0.0,
            cur?.rawRssi ?: -99, cur?.avgRssi ?: -99.0, 99.0, 0.0, "receding")
    }

    // Called on handlerThread by the companion callbacks
    private fun doSelectBus(busId: String) {
        if (state != State.AMBIGUOUS || !ambiguousCandidates.contains(busId)) return
        state = State.CONFIRMED; confirmedBus = busId
        boardedAtMs = System.currentTimeMillis()
        tracks[busId]?.let { confirmedHistory.clear(); confirmedHistory.addAll(it.rssiHistory) }
        tracks.clear(); ambiguousCandidates = emptyList()
        persistState()
    }

    private fun doConfirmDeboard() {
        val bus = confirmedBus ?: return
        state = State.LOST; confirmedBus = null; boardedAtMs = null
        confirmedHistory.clear(); pendingDeboardSince = null; lostSince = null
        clearPersistedState()
        val result = detection(bus, "lost", 0.0, -99, -99.0, 99.0, 0.0, "receding")
        lastResult = result; onDetection?.invoke(result, emptyList())
    }

    private fun doCancelDeboard() {
        if (state != State.PENDING_DEBOARD) return
        state = State.CONFIRMED; pendingDeboardSince = null; lostSince = null
    }

    private fun handleLost(scans: List<BeaconData>, now: Long): Map<String, Any?> {
        clearPersistedState()
        tracks.clear(); confirmedHistory.clear(); lostSince = null
        state = State.SCANNING
        return handleSearching(scans, now)
    }

    private fun idle() = detection(null, "scanning", 0.0, 0, 0.0, 0.0, 0.0, "stable")

    private fun detection(
        busId: String?, state: String, confidence: Double,
        rawRssi: Int, avgRssi: Double, distanceM: Double,
        distanceScore: Double, trend: String,
        candidates: List<String> = emptyList()
    ): Map<String, Any?> = mapOf(
        "busId" to busId, "state" to state, "confidence" to confidence,
        "rawRssi" to rawRssi, "avgRssi" to avgRssi,
        "distanceM" to distanceM, "distanceScore" to distanceScore, "trend" to trend,
        "boardedAtMs" to boardedAtMs, "candidates" to candidates
    )

    // ── Math helpers ──────────────────────────────────────────────────────────

    private fun rssiToDistance(rssi: Double) =
        Math.pow(10.0, (TX_POWER_1M - rssi) / (10.0 * PATH_LOSS_N))

    private fun distanceToScore(d: Double) =
        (1.0 - d / 5.0).coerceIn(0.0, 1.0)

    private fun confidence(dscore: Double, stableMs: Long) =
        dscore * (stableMs.toDouble() / STABILITY_MS).coerceIn(0.0, 1.0)

    private fun rssiSlope(h: List<Double>): Double {
        val n = h.size; if (n < 3) return 0.0
        val mx = (n - 1) / 2.0; val my = h.average()
        var num = 0.0; var den = 0.0
        for (i in h.indices) { num += (i - mx) * (h[i] - my); den += (i - mx) * (i - mx) }
        return if (den == 0.0) 0.0 else num / den
    }

    private fun rssiVariance(h: List<Double>): Double {
        if (h.size < 2) return 0.0
        val mean = h.average()
        return h.map { (it - mean) * (it - mean) }.average()
    }

    private fun toTrend(slope: Double) = when {
        slope > TREND_SLOPE_DB  -> "approaching"
        slope < -TREND_SLOPE_DB -> "receding"
        else                    -> "stable"
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                NOTIF_CHANNEL, "Bus Detection", NotificationManager.IMPORTANCE_DEFAULT
            ).apply { vibrationPattern = longArrayOf(0, 250, 250, 250) }
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun appIconRes() = resources.getIdentifier("ic_launcher", "mipmap", packageName)
        .takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info

    private fun buildForegroundNotification(): Notification =
        NotificationCompat.Builder(this, NOTIF_CHANNEL)
            .setContentTitle("Bus Detection Active")
            .setContentText("Scanning for nearby buses")
            .setSmallIcon(appIconRes())
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build()

    private fun fireNotifications(prev: String, next: String, busId: String?) {
        val nm   = getSystemService(NotificationManager::class.java)
        val icon = appIconRes()
        fun build(title: String, body: String) =
            NotificationCompat.Builder(this, NOTIF_CHANNEL)
                .setContentTitle(title).setContentText(body)
                .setSmallIcon(icon).setAutoCancel(true).build()

        when {
            prev == "scanning" && next == "candidate" && busId != null ->
                nm.notify(BOARD_NOTIF_ID, build("Bus detected nearby", "Verifying $busId — hold on…"))

            next == "ambiguous" ->
                nm.notify(BOARD_NOTIF_ID, build("Multiple buses detected", "Open the app to select your bus"))

            prev == "candidate" && next == "scanning" ->
                nm.cancel(BOARD_NOTIF_ID)

            prev != "confirmed" && next == "confirmed" && busId != null -> {
                nm.cancel(BOARD_NOTIF_ID)
                nm.notify(BOARD_NOTIF_ID, build("Boarded", "You are on $busId"))
            }

            next == "pendingDeboard" && busId != null ->
                nm.notify(DEBOARD_NOTIF_ID, build("Did you deboard?", "Tap to confirm you left $busId"))

            prev == "pendingDeboard" && next == "confirmed" ->
                nm.cancel(DEBOARD_NOTIF_ID)

            next == "lost" && busId != null -> {
                nm.cancel(DEBOARD_NOTIF_ID)
                nm.notify(DEBOARD_NOTIF_ID, build("Deboarded", "You have left $busId"))
            }
        }
    }
}
