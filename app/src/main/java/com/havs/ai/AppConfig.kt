package com.havs.ai

import android.content.Context
import android.net.Uri

object AppConfig {
    private const val PREFS = "havs_prefs"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun webUrl(context: Context): String =
        prefs(context).getString("web_url", BuildConfig.DEFAULT_WEB_URL) ?: BuildConfig.DEFAULT_WEB_URL

    fun apiUrl(context: Context): String =
        prefs(context).getString("api_url", BuildConfig.DEFAULT_API_URL) ?: BuildConfig.DEFAULT_API_URL

    fun setWebUrl(context: Context, url: String) {
        prefs(context).edit().putString("web_url", url).apply()
    }

    fun sourceOrigin(context: Context): String {
        val uri = Uri.parse(webUrl(context))
        val port = if (uri.port > 0) ":${uri.port}" else ""
        return "${uri.scheme}://${uri.host}$port"
    }

    fun set(context: Context, key: String, value: String) {
        prefs(context).edit().putString(key, value).apply()
    }

    fun get(context: Context, key: String): String? = prefs(context).getString(key, null)

    fun fcmToken(context: Context): String? = prefs(context).getString("fcm_token", null)
}
