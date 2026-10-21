package com.havs.ai.bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import com.havs.ai.AppConfig
import com.havs.ai.BuildConfig
import com.havs.ai.analytics.AnalyticsClient
import com.havs.ai.push.PushPermissionActivity
import org.json.JSONObject

class NativeBridge(private val activity: Activity) {

    fun onWebMessage(raw: String) {
        val message = BridgeProtocol.parse(raw)
        if (message == null) {
            Log.w(TAG, "rejected message: ${raw.take(120)}")
            return
        }
        Log.i(TAG, "web->native ${message.type} id=${message.id}")
        when (message.type) {
            BridgeProtocol.DEVICE_INFO -> respond(
                message,
                JSONObject()
                    .put("platform", "android")
                    .put("model", Build.MODEL)
                    .put("manufacturer", Build.MANUFACTURER)
                    .put("osVersion", Build.VERSION.RELEASE)
                    .put("sdk", Build.VERSION.SDK_INT)
                    .put("appVersion", BuildConfig.VERSION_NAME)
                    .put("package", BuildConfig.APPLICATION_ID)
            )

            BridgeProtocol.PUSH_STATE, BridgeProtocol.PUSH_PERMISSION_STATUS ->
                respond(message, pushState())

            BridgeProtocol.REQUEST_PUSH_PERMISSION -> {
                activity.startActivity(
                    Intent(activity, PushPermissionActivity::class.java)
                        .setData(Uri.parse("havs-push://permission"))
                )
                respond(message, JSONObject().put("requested", true))
            }

            BridgeProtocol.OPEN_PUSH_SETTINGS -> {
                activity.startActivity(
                    Intent(activity, PushPermissionActivity::class.java)
                        .setData(Uri.parse("havs-push://settings"))
                )
                respond(message, JSONObject().put("opened", true))
            }

            BridgeProtocol.SET_THEME -> {
                val theme = message.payload.optString("theme", "system")
                AppConfig.set(activity, "theme", theme)
                respond(message, JSONObject().put("theme", theme))
            }

            BridgeProtocol.TRACK_EVENT -> {
                val props = message.payload.optJSONObject("props")
                val values = props?.keys()?.asSequence()
                    ?.associateWith { props.optString(it) } ?: emptyMap()
                AnalyticsClient.track(
                    activity,
                    message.payload.optString("event", "unknown"),
                    values
                )
                respond(message, JSONObject().put("tracked", true))
            }

            BridgeProtocol.ROUTE -> {
                val route = message.payload.optString("path", "/")
                AppConfig.set(activity, "pending_route", route)
                respond(message, JSONObject().put("route", route))
            }

            BridgeProtocol.IDENTIFY -> {
                val accepted = JSONObject()
                listOf("userId", "email", "name").forEach { key ->
                    if (message.payload.has(key)) {
                        AppConfig.set(activity, "identity_$key", message.payload.optString(key))
                        accepted.put(key, true)
                    }
                }
                respond(message, accepted)
            }

            else -> respond(message, null, "unsupported")
        }
    }

    private fun pushState(): JSONObject {
        val enabled = androidx.core.app.NotificationManagerCompat.from(activity).areNotificationsEnabled()
        return JSONObject()
            .put("enabled", enabled)
            .put("token", AppConfig.fcmToken(activity) ?: JSONObject.NULL)
    }

    private fun respond(message: BridgeMessage, data: JSONObject?, error: String? = null) {
        BridgeHub.send(BridgeProtocol.response(message.id, error == null, data, error))
    }

    companion object {
        private const val TAG = "HavsBridge"
    }
}
