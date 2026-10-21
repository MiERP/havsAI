package com.havs.ai.analytics

import android.content.Context
import android.util.Log
import com.havs.ai.AppConfig
import org.json.JSONObject
import kotlin.concurrent.thread

object AnalyticsClient {
    fun track(context: Context, event: String, props: Map<String, String> = emptyMap()) {
        Log.i(TAG, "$event $props")
        val body = JSONObject()
            .put("event", event)
            .put("props", JSONObject(props))
            .toString()
        thread {
            runCatching {
                val connection = java.net.URL(AppConfig.apiUrl(context).trimEnd('/') + "/events")
                    .openConnection() as java.net.HttpURLConnection
                connection.requestMethod = "POST"
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.connectTimeout = 3000
                connection.readTimeout = 3000
                connection.outputStream.use { it.write(body.toByteArray()) }
                connection.responseCode
                connection.disconnect()
            }.onFailure { Log.w(TAG, "post failed: ${it.message}") }
        }
    }

    private const val TAG = "HavsAnalytics"
}
