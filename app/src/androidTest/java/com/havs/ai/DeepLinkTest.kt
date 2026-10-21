package com.havs.ai

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DeepLinkTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun identifyDeepLinkResolves() = assertResolves(
        "com.havs.ai.deeplink.IdentifyActivity",
        "havs-identify://set?userId=test-user"
    )

    @Test
    fun pushPermissionDeepLinkResolves() = assertResolves(
        "com.havs.ai.push.PushPermissionActivity",
        "havs-push://permission"
    )

    @Test
    fun pushSettingsDeepLinkResolves() = assertResolves(
        "com.havs.ai.push.PushPermissionActivity",
        "havs-push://settings"
    )

    @Test
    fun reviewDeepLinkResolves() = assertResolves(
        "com.havs.ai.review.ReviewActivity",
        "app-review://launch"
    )

    @Test
    fun appLinkResolves() {
        val target = Uri.parse(AppConfig.webUrl(context)).buildUpon().path("/onboarding").build()
        val intent = Intent(Intent.ACTION_VIEW, target)
            .setPackage(context.packageName)
        val resolved = context.packageManager.resolveActivity(intent, 0)
        assertNotNull("no activity for app link", resolved)
        assertEquals(context.packageName, resolved!!.activityInfo.packageName)
    }

    @Test
    fun retiredAppLinkHostDoesNotResolve() {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://app.havs.ai/onboarding"))
            .setPackage(context.packageName)
        assertNull(
            "retired host should not be registered",
            context.packageManager.resolveActivity(intent, 0)
        )
    }

    private fun assertResolves(className: String, url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .setClassName(context, className)
        val resolved = context.packageManager.resolveActivity(intent, 0)
        assertNotNull("no activity for $url", resolved)
        assertEquals(className, resolved!!.activityInfo.name)
    }
}
