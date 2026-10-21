package com.havs.ai.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushRoutePolicyTest {
    private val base = "https://103-20-102-229.sslip.io/"

    @Test
    fun relativePathsAreKept() {
        assertEquals("/onboarding", PushRoutePolicy.resolve(base, "/onboarding"))
        assertEquals("/exam-preps/42?tab=plan", PushRoutePolicy.resolve(base, "/exam-preps/42?tab=plan"))
    }

    @Test
    fun sameOriginUrlsBecomePaths() {
        assertEquals("/onboarding", PushRoutePolicy.resolve(base, "https://103-20-102-229.sslip.io/onboarding"))
        assertEquals("/x?y=1#z", PushRoutePolicy.resolve(base, "https://103-20-102-229.sslip.io/x?y=1#z"))
    }

    @Test
    fun foreignOriginsAndSchemesAreRejected() {
        assertNull(PushRoutePolicy.resolve(base, "https://evil.example/onboarding"))
        assertNull(PushRoutePolicy.resolve(base, "http://103-20-102-229.sslip.io/onboarding"))
        assertNull(PushRoutePolicy.resolve(base, "javascript:alert(1)"))
        assertNull(PushRoutePolicy.resolve(base, "intent://evil#Intent;end"))
    }

    @Test
    fun dangerousRelativeValuesAreRejected() {
        assertNull(PushRoutePolicy.resolve(base, ""))
        assertNull(PushRoutePolicy.resolve(base, null))
        assertNull(PushRoutePolicy.resolve(base, "//evil.example/onboarding"))
        assertNull(PushRoutePolicy.resolve(base, "/\\evil.example"))
        assertNull(PushRoutePolicy.resolve(base, "/%5C%5Cevil.example"))
        assertNull(PushRoutePolicy.resolve(base, "/%2F%2Fevil.example"))
        assertNull(PushRoutePolicy.resolve(base, "/onboarding\r\nSet-Cookie: x=1"))
    }
}
