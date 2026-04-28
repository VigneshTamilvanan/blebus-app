package `in`.nammayatri.blebus

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.modules.core.DeviceEventManagerModule

class BLEModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

    override fun getName() = "BLEDetection"

    // Wire up the static callback when the RN module is initialized.
    // This is called on the RN background thread when the React instance starts.
    override fun initialize() {
        super.initialize()

        // Emit cached state immediately so the UI doesn't flash IDLE on app reopen.
        val ctx = reactApplicationContext
        BLEDetectionService.lastResult?.let { cached ->
            try { emitDetection(ctx, cached, BLEDetectionService.lastRawScans) } catch (_: Exception) {}
        }

        BLEDetectionService.onDetection = { result, rawScans ->
            if (ctx.hasActiveReactInstance()) {
                try { emitDetection(ctx, result, rawScans) } catch (_: Exception) {}
            }
        }
    }

    // Clear the callback when the RN module is torn down (e.g. app reload).
    override fun invalidate() {
        BLEDetectionService.onDetection = null
        super.invalidate()
    }

    @ReactMethod
    fun start(customNames: ReadableArray) {
        val names = ArrayList<String>()
        for (i in 0 until customNames.size()) {
            customNames.getString(i)?.let { names.add(it) }
        }
        val intent = Intent(reactApplicationContext, BLEDetectionService::class.java)
            .putStringArrayListExtra(BLEDetectionService.EXTRA_CUSTOM_NAMES, names)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactApplicationContext.startForegroundService(intent)
        } else {
            reactApplicationContext.startService(intent)
        }
    }

    @ReactMethod
    fun stop() {
        reactApplicationContext.stopService(
            Intent(reactApplicationContext, BLEDetectionService::class.java)
        )
    }

    @ReactMethod
    fun selectBus(busId: String) { BLEDetectionService.onSelectBus?.invoke(busId) }

    @ReactMethod
    fun confirmDeboard() { BLEDetectionService.onConfirmDeboard?.invoke() }

    @ReactMethod
    fun cancelDeboard() { BLEDetectionService.onCancelDeboard?.invoke() }

    @ReactMethod
    fun confirmSwitch(busId: String) { BLEDetectionService.onConfirmSwitch?.invoke(busId) }

    @ReactMethod
    fun dismissSwitch() { BLEDetectionService.onDismissSwitch?.invoke() }

    // Required by RN event emitter infrastructure
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Double) {}

    // ── Build and emit the ble_detection_update event ─────────────────────────

    private fun emitDetection(
        ctx: ReactApplicationContext,
        result: Map<String, Any?>,
        rawScans: List<Map<String, Any>>
    ) {
        val resultMap = Arguments.createMap().apply {
            putString("state",       result["state"] as? String ?: "scanning")
            putString("trend",       result["trend"]  as? String ?: "stable")
            putString("busId",       result["busId"]  as? String)
            putDouble("confidence",  (result["confidence"]   as? Number)?.toDouble() ?: 0.0)
            putDouble("rawRssi",     (result["rawRssi"]      as? Number)?.toDouble() ?: 0.0)
            putDouble("avgRssi",     (result["avgRssi"]      as? Number)?.toDouble() ?: 0.0)
            putDouble("distanceM",   (result["distanceM"]    as? Number)?.toDouble() ?: 0.0)
            putDouble("distanceScore", (result["distanceScore"] as? Number)?.toDouble() ?: 0.0)
            val bms = (result["boardedAtMs"] as? Number)?.toDouble()
            if (bms != null) putDouble("boardedAtMs", bms) else putNull("boardedAtMs")
            val cands = Arguments.createArray()
            (result["candidates"] as? List<*>)?.forEach { cands.pushString(it as? String ?: "") }
            putArray("candidates", cands)
            val sc = result["switchCandidate"] as? String
            if (sc != null) putString("switchCandidate", sc) else putNull("switchCandidate")
            val lbs = (result["lastBeaconSeenMs"] as? Number)?.toDouble()
            if (lbs != null) putDouble("lastBeaconSeenMs", lbs) else putNull("lastBeaconSeenMs")
            val lbLat = result["lastBeaconSeenLat"] as? Double
            val lbLng = result["lastBeaconSeenLng"] as? Double
            if (lbLat != null) putDouble("lastBeaconSeenLat", lbLat) else putNull("lastBeaconSeenLat")
            if (lbLng != null) putDouble("lastBeaconSeenLng", lbLng) else putNull("lastBeaconSeenLng")
            val lat = result["lat"] as? Double
            val lng = result["lng"] as? Double
            if (lat != null) putDouble("lat", lat) else putNull("lat")
            if (lng != null) putDouble("lng", lng) else putNull("lng")
        }

        val scansArray = Arguments.createArray()
        for (scan in rawScans) {
            val s = Arguments.createMap()
            s.putString("busId",     scan["busId"]     as? String ?: "")
            s.putBoolean("isBus",    scan["isBus"]     as? Boolean ?: false)
            s.putDouble("rawRssi",   (scan["rawRssi"]  as? Number)?.toDouble() ?: 0.0)
            s.putDouble("avgRssi",   (scan["avgRssi"]  as? Number)?.toDouble() ?: 0.0)
            s.putDouble("distanceM", (scan["distanceM"] as? Number)?.toDouble() ?: 0.0)
            scansArray.pushMap(s)
        }

        val payload = Arguments.createMap().apply {
            putMap("result",   resultMap)
            putArray("rawScans", scansArray)
        }

        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("ble_detection_update", payload)
    }
}
