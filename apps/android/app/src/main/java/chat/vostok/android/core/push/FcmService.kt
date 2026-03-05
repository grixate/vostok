package chat.vostok.android.core.push

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class FcmService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Log.d("FcmService", "new token: $token")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        Log.d("FcmService", "message: ${message.data}")
    }
}
