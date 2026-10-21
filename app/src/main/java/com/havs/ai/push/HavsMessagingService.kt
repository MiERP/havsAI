package com.havs.ai.push

import android.app.PendingIntent
import android.content.Intent
import android.graphics.Color
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.havs.ai.AppConfig
import com.havs.ai.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class HavsMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        Log.i(TAG, "new FCM token")
        AppConfig.set(this, "fcm_token", token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: "havsAI"
        val body = message.notification?.body ?: message.data["body"] ?: ""
        val url = message.data["url"] ?: ""
        Log.i(TAG, "push title=$title url=$url")

        val open = Intent(this, PushOpenActivity::class.java)
            .setAction(ACTION_OPEN_PUSH)
            .putExtra("url", url)
        val pending = PendingIntent.getActivity(
            this,
            url.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, getString(R.string.push_channel_id))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setColor(Color.rgb(0, 161, 13))
            .build()

        runCatching {
            NotificationManagerCompat.from(this).notify(url.hashCode(), notification)
        }.onFailure { Log.w(TAG, "notify failed: ${it.message}") }
    }

    companion object {
        const val TAG = "HavsFCM"
        const val ACTION_OPEN_PUSH = "com.havs.ai.OPEN_PUSH"
    }
}
