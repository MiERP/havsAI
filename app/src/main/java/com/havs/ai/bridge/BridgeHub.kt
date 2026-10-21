package com.havs.ai.bridge

object BridgeHub {
    @Volatile
    var sender: ((String) -> Unit)? = null

    fun send(json: String) {
        runCatching { sender?.invoke(json) }
    }
}
