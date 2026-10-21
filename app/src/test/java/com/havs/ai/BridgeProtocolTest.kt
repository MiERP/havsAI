package com.havs.ai

import com.havs.ai.bridge.BridgeProtocol
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeProtocolTest {

    @Test
    fun parsesAllowedMessage() {
        val message = BridgeProtocol.parse("""{"id":"1","type":"havs-device-info","payload":{}}""")
        assertNotNull(message)
        assertEquals("havs-device-info", message!!.type)
        assertEquals("1", message.id)
    }

    @Test
    fun rejectsUnknownType() {
        assertNull(BridgeProtocol.parse("""{"type":"evil-message"}"""))
    }

    @Test
    fun rejectsMalformedJson() {
        assertNull(BridgeProtocol.parse("not-json"))
    }

    @Test
    fun buildsResponseEnvelope() {
        val raw = BridgeProtocol.response("42", true, JSONObject().put("ok", 1))
        assertTrue(raw.contains("\"id\":\"42\""))
        assertTrue(raw.contains("\"ok\":true"))
    }

    @Test
    fun buildsEventEnvelope() {
        val raw = BridgeProtocol.event(BridgeProtocol.IDENTIFY, "7", JSONObject().put("userId", true))
        assertTrue(raw.contains("\"type\":\"havs-identify\""))
        assertTrue(raw.contains("\"id\":\"7\""))
    }
}
