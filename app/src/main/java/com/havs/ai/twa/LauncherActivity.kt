package com.havs.ai.twa

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsServiceConnection
import androidx.browser.customtabs.CustomTabsSession
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import com.havs.ai.AppConfig
import com.havs.ai.bridge.BridgeHub
import com.havs.ai.bridge.BridgeProtocol
import com.havs.ai.bridge.NativeBridge

class LauncherActivity : Activity() {

    private var session: CustomTabsSession? = null
    private var validated = false
    private var launched = false
    private var channelReady = false
    private var channelRequested = false
    private var nativeReadySent = false
    private var lastLaunchAt = 0L
    private lateinit var statusView: TextView
    private lateinit var retryButton: Button
    private lateinit var bridge: NativeBridge
    private val handler = Handler(Looper.getMainLooper())

    private val callback = object : CustomTabsCallback() {
        override fun onRelationshipValidationResult(
            relation: Int,
            requestedOrigin: Uri,
            result: Boolean,
            extras: Bundle?
        ) {
            validated = result
            Log.i(TAG, "relationship validation=$result origin=$requestedOrigin")
        }

        override fun onNavigationEvent(navigationEvent: Int, extras: Bundle?) {
            if (navigationEvent == CustomTabsCallback.NAVIGATION_FINISHED) requestChannel()
        }

        override fun onMessageChannelReady(extras: Bundle?) {
            if (nativeReadySent) return
            nativeReadySent = true
            channelReady = true
            updateStatus("Đã kết nối. Đang mở havsAI…")
            Log.i(TAG, "postMessage channel ready")
            sendNativeReady()
        }

        override fun onPostMessage(message: String, extras: Bundle?) {
            channelReady = false
            bridge.onWebMessage(message)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildSplash())
        bridge = NativeBridge(this)
        intent?.getStringExtra("web_url")?.let { AppConfig.setWebUrl(this, it) }
        BridgeHub.sender = { json -> session?.postMessage(json, null) }
        bindService()
    }

    private fun buildSplash(): View {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.rgb(13, 13, 13))
            setPadding(48, 48, 48, 48)
        }
        layout.addView(TextView(this).apply {
            text = "havsAI"
            textSize = 30f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        statusView = TextView(this).apply {
            text = "Đang kết nối…"
            textSize = 15f
            setTextColor(Color.rgb(170, 170, 170))
            gravity = Gravity.CENTER
            setPadding(0, 20, 0, 32)
        }
        layout.addView(statusView)
        retryButton = Button(this).apply {
            text = "Mở lại havsAI"
            visibility = View.GONE
            setOnClickListener {
                retryButton.visibility = View.GONE
                updateStatus("Đang mở lại…")
                launched = false
                channelRequested = false
                nativeReadySent = false
                if (session == null) bindService() else launchTwa()
            }
        }
        layout.addView(retryButton)
        return layout
    }

    private fun updateStatus(text: String) {
        statusView.text = text
    }

    private fun bindService() {
        val packageName = CustomTabsClient.getPackageName(this, null)
        if (packageName == null) {
            Log.w(TAG, "no Custom Tabs provider installed")
            launchAsCustomTab()
            return
        }
        val bound = CustomTabsClient.bindCustomTabsService(
            this,
            packageName,
            object : CustomTabsServiceConnection() {
                override fun onCustomTabsServiceConnected(
                    name: ComponentName,
                    client: CustomTabsClient
                ) {
                    Log.i(TAG, "connected to ${name.packageName}")
                    client.warmup(0L)
                    session = client.newSession(callback)
                    BridgeHub.sender = { json -> session?.postMessage(json, null) }
                    requestChannel()
                    launchTwa()
                }

                override fun onServiceDisconnected(name: ComponentName) {
                    Log.w(TAG, "Custom Tabs disconnected")
                    session = null
                }
            }
        )
        Log.i(TAG, "bindCustomTabsService=$bound package=$packageName")
        if (!bound) launchAsCustomTab()
    }

    private fun requestChannel() {
        if (channelRequested) return
        val current = session ?: return
        channelRequested = true
        val origin = Uri.parse(AppConfig.sourceOrigin(this))
        val result = runCatching {
            current.requestPostMessageChannel(origin, origin, Bundle())
        }.getOrDefault(false)
        Log.i(TAG, "requestPostMessageChannel origin=$origin result=$result")
    }

    private fun launchUri(): Uri {
        val data = intent?.data
        return if (data != null && data.scheme == "https" && data.host == "app.havs.ai") data else Uri.parse(AppConfig.webUrl(this))
    }

    private fun launchTwa() {
        if (launched) return
        updateStatus("Đang mở havsAI…")
        val uri = launchUri()
        val current = session
        val ok = runCatching {
            if (current != null) {
                startActivity(TrustedWebActivityIntentBuilder(uri).build(current).intent)
            } else {
                CustomTabsIntent.Builder().build().launchUrl(this, uri)
            }
        }.onFailure { Log.w(TAG, "TWA launch failed: ${it.message}") }.isSuccess
        if (ok) {
            launched = true
            lastLaunchAt = System.currentTimeMillis()
        } else {
            updateStatus("Không mở được Chrome. Kiểm tra Chrome rồi thử lại.")
            retryButton.visibility = View.VISIBLE
            launchAsCustomTab()
        }
    }

    private fun launchAsCustomTab() {
        if (launched) return
        updateStatus("Đang mở bằng Custom Tabs…")
        launched = true
        lastLaunchAt = System.currentTimeMillis()
        val uri = launchUri()
        runCatching {
            val builder = session?.let { CustomTabsIntent.Builder(it) } ?: CustomTabsIntent.Builder()
            builder.build().launchUrl(this, uri)
        }.onFailure {
            Log.e(TAG, "Custom Tab launch failed", it)
            updateStatus("Không mở được trình duyệt. Bấm “Mở lại”.")
            retryButton.visibility = View.VISIBLE
        }
    }

    private fun sendNativeReady() {
        val message = "{\"type\":\"${BridgeProtocol.NATIVE_READY}\"}"
        var attempt = 0
        val retry = object : Runnable {
            override fun run() {
                if (!channelReady || attempt >= 5) return
                session?.postMessage(message, null)
                attempt++
                handler.postDelayed(this, 1500)
            }
        }
        handler.post(retry)
    }

    override fun onResume() {
        super.onResume()
        if (launched && System.currentTimeMillis() - lastLaunchAt > 1500) {
            updateStatus("havsAI đã đóng. Bấm “Mở lại” để tiếp tục.")
            retryButton.visibility = View.VISIBLE
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra("web_url")?.let { AppConfig.setWebUrl(this, it) }
    }

    override fun onDestroy() {
        BridgeHub.sender = null
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        private const val TAG = "HavsTWA"
    }
}
