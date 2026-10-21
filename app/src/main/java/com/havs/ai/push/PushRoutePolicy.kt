package com.havs.ai.push

import java.net.URI
import java.net.URLDecoder

object PushRoutePolicy {
    fun resolve(baseUrl: String, raw: String?): String? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null
        if (value.any { it == '\n' || it == '\r' || it == '\\' }) return null
        if (value.startsWith("/")) {
            if (value.startsWith("//")) return null
            val decoded = runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
            if (decoded.startsWith("//") || decoded.contains('\\')) return null
            return value
        }

        val base = runCatching { URI(baseUrl) }.getOrNull() ?: return null
        val target = runCatching { URI(value) }.getOrNull() ?: return null
        if (target.isOpaque) return null
        if (!target.scheme.equals(base.scheme, ignoreCase = true)) return null
        if (!target.host.equals(base.host, ignoreCase = true)) return null
        if (target.port != base.port) return null

        val path = target.rawPath?.takeIf { it.startsWith("/") } ?: "/"
        val query = target.rawQuery?.let { "?$it" } ?: ""
        val fragment = target.rawFragment?.let { "#$it" } ?: ""
        return path + query + fragment
    }
}
