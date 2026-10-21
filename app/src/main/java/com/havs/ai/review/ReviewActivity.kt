package com.havs.ai.review

import android.app.Activity
import android.os.Bundle
import com.havs.ai.bridge.BridgeHub
import com.havs.ai.bridge.BridgeProtocol
import com.google.android.play.core.review.ReviewManagerFactory
import org.json.JSONObject

class ReviewActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val manager = ReviewManagerFactory.create(this)
        manager.requestReviewFlow().addOnCompleteListener { request ->
            if (!request.isSuccessful) {
                report(false, request.exception?.message)
                return@addOnCompleteListener
            }
            manager.launchReviewFlow(this, request.result).addOnCompleteListener { result ->
                report(result.isSuccessful, result.exception?.message)
            }
        }
    }

    private fun report(ok: Boolean, detail: String?) {
        val data = JSONObject().put("completed", ok)
        if (detail != null) data.put("detail", detail)
        BridgeHub.send(BridgeProtocol.event(BridgeProtocol.REVIEW, null, data))
        if (!isFinishing) finish()
    }
}
