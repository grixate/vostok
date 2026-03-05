package chat.vostok.android.core.storage

import android.content.Context
import java.io.File

class MediaCache(context: Context) {
    private val root = File(context.filesDir, "media-cache").apply { mkdirs() }

    fun file(path: String): File = File(root, path)
}
