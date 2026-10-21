package com.havs.ai

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.havs.ai.push.HavsMessagingService
import com.havs.ai.push.PushOpenActivity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PushOpenActivityTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun pushOpenActivityIsNotExported() {
        val info = context.packageManager.getActivityInfo(
            ComponentName(context, PushOpenActivity::class.java),
            0
        )
        assertFalse(info.exported)
    }

    @Test
    fun pushActionDoesNotResolveExternally() {
        val intent = Intent(HavsMessagingService.ACTION_OPEN_PUSH).setPackage(context.packageName)
        assertNull(context.packageManager.resolveActivity(intent, 0))
    }
}
