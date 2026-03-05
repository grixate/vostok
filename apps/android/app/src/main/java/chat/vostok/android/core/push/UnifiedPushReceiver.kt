package chat.vostok.android.core.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class UnifiedPushReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.d("UnifiedPushReceiver", "intent: ${intent.action}")
    }
}
