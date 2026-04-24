package `in`.nammayatri.blebus

import android.content.Context
import android.os.PowerManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class WakeLockModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun getName() = "WakeLock"

    @ReactMethod
    fun acquire() {
        if (wakeLock?.isHeld == true) return
        val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "blebus:scanner"
        ).also { it.acquire(12 * 60 * 60 * 1000L) }
    }

    @ReactMethod
    fun release() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }
}
