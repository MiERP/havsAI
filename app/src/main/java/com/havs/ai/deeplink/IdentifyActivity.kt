package com.havs.ai.deeplink

import android.app.Activity
import android.os.Bundle
import com.havs.ai.AppConfig
import com.havs.ai.analytics.AnalyticsClient
import com.havs.ai.bridge.BridgeHub
import com.havs.ai.bridge.BridgeProtocol
import org.json.JSONObject

class IdentifyActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val accepted = JSONObject()
        ALLOWED_KEYS.forEach { key ->
            intent?.data?.getQueryParameter(key)?.takeIf { it.isNotBlank() }?.let { value ->
                AppConfig.set(this, "identity_$key", value)
                accepted.put(key, true)
            }
        }
        BridgeHub.send(BridgeProtocol.event(BridgeProtocol.IDENTIFY, null, accepted))
        AnalyticsClient.track(
            this,
            "identify",
            accepted.keys().asSequence().associateWith { "set" }
        )
        finish()
    }

    companion object {
        private val ALLOWED_KEYS = listOf("userId", "email", "name")
    }
}
