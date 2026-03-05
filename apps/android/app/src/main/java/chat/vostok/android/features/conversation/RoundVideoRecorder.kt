package chat.vostok.android.features.conversation

import android.content.Context
import java.io.File

class RoundVideoRecorder(
    private val context: Context
) {
    private var outputFile: File? = null

    fun beginPlaceholderCapture(): File {
        val file = File(context.cacheDir, "round-${System.currentTimeMillis()}.mp4")
        outputFile = file
        return file
    }

    fun finishPlaceholderCapture(): File? {
        return outputFile
    }
}
