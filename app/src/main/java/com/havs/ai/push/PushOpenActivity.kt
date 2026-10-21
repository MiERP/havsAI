package com.havs.ai.push

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.havs.ai.AppConfig
import com.havs.ai.bridge.BridgeHub
import com.havs.ai.bridge.BridgeProtocol
import com.havs.ai.twa.LauncherActivity
import org.json.JSONObject

class PushOpenActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val route = PushRoutePolicy.resolve(AppConfig.webUrl(this), intent?.getStringExtra("url"))

        if (route != null && BridgeHub.sender != null) {
            BridgeHub.send(
                BridgeProtocol.event(
                    BridgeProtocol.ROUTE,
                    null,
                    JSONObject().put("path", route).put("source", "push")
                )
            )
            finish()
            return
        }

        if (route != null) AppConfig.set(this, "pending_route", route)
        startActivity(
            Intent(this, LauncherActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        )
        finish()
    }
}
