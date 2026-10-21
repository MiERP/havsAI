package com.havs.ai.push

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.havs.ai.bridge.BridgeHub
import com.havs.ai.bridge.BridgeProtocol
import org.json.JSONObject

class PushPermissionActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent?.data?.host == "settings") {
            startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            )
            report()
            finish()
            return
        }
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE)
        } else {
            report()
            finish()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        report()
        finish()
    }

    private fun report() {
        val enabled = NotificationManagerCompat.from(this).areNotificationsEnabled()
        BridgeHub.send(
            BridgeProtocol.event(
                BridgeProtocol.PUSH_PERMISSION_STATUS,
                null,
                JSONObject().put("enabled", enabled)
            )
        )
    }

    companion object {
        private const val REQUEST_CODE = 100
    }
}
