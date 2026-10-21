package com.havs.ai.bridge

import org.json.JSONObject

data class BridgeMessage(val id: String?, val type: String, val payload: JSONObject)

object BridgeProtocol {
    const val NATIVE_READY = "havs-native-ready"
    const val DEVICE_INFO = "havs-device-info"
    const val PUSH_STATE = "havs-push-state"
    const val PUSH_PERMISSION_STATUS = "havs-push-permission-status"
    const val REQUEST_PUSH_PERMISSION = "havs-request-push-permission"
    const val OPEN_PUSH_SETTINGS = "havs-open-push-settings"
    const val SET_THEME = "havs-set-theme"
    const val TRACK_EVENT = "havs-track-event"
    const val ROUTE = "havs_route"
    const val IDENTIFY = "havs-identify"
    const val REVIEW = "app-review"

    val ALLOWED = setOf(
        DEVICE_INFO,
        PUSH_STATE,
        REQUEST_PUSH_PERMISSION,
        OPEN_PUSH_SETTINGS,
        SET_THEME,
        TRACK_EVENT,
        ROUTE,
        IDENTIFY
    )

    fun parse(raw: String): BridgeMessage? = runCatching {
        val json = JSONObject(raw)
        val type = json.optString("type", "")
        if (type !in ALLOWED) null
        else BridgeMessage(
            if (json.has("id")) json.getString("id") else null,
            type,
            json.optJSONObject("payload") ?: JSONObject()
        )
    }.getOrNull()

    fun response(id: String?, ok: Boolean, data: JSONObject? = null, error: String? = null): String {
        val json = JSONObject()
        if (id != null) json.put("id", id)
        json.put("ok", ok)
        if (data != null) json.put("data", data)
        if (error != null) json.put("error", error)
        return json.toString()
    }

    fun event(type: String, id: String?, data: JSONObject?): String {
        val json = JSONObject().put("type", type)
        if (id != null) json.put("id", id)
        if (data != null) json.put("data", data)
        return json.toString()
    }
}
