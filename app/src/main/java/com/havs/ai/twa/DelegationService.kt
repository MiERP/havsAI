package com.havs.ai.twa

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log

/**
 * TWA delegation endpoint. Chrome binds this service when it wants the app to
 * display delegated notifications. The full TrustedWebActivityService binding
 * is intentionally left as a stub in this rewrite.
 */
class DelegationService : Service() {
    override fun onBind(intent: Intent?): IBinder? {
        Log.i("HavsDelegation", "onBind action=${intent?.action}")
        return null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY
}
