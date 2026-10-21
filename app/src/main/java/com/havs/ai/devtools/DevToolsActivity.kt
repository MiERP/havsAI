package com.havs.ai.devtools

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.havs.ai.AppConfig
import com.havs.ai.twa.LauncherActivity

class DevToolsActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }
        layout.addView(TextView(this).apply { text = "Web URL" })
        val web = EditText(this).apply { setText(AppConfig.webUrl(this@DevToolsActivity)) }
        layout.addView(web, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        layout.addView(TextView(this).apply { text = "API URL" })
        val api = EditText(this).apply { setText(AppConfig.apiUrl(this@DevToolsActivity)) }
        layout.addView(api, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        layout.addView(Button(this).apply {
            text = "Save & Restart"
            setOnClickListener {
                AppConfig.setWebUrl(this@DevToolsActivity, web.text.toString().trim())
                AppConfig.set(this@DevToolsActivity, "api_url", api.text.toString().trim())
                startActivity(
                    Intent(this@DevToolsActivity, LauncherActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                )
                finish()
            }
        })
        setContentView(layout)
    }
}
