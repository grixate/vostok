package chat.vostok.android.features.conversation

import android.content.Context
import android.media.MediaRecorder
import java.io.File

class VoiceRecorder(
    private val context: Context
) {
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null

    @Suppress("DEPRECATION")
    fun start(): File {
        val file = File(context.cacheDir, "voice-${System.currentTimeMillis()}.m4a")

        val mediaRecorder = MediaRecorder().apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioSamplingRate(44_100)
            setAudioEncodingBitRate(96_000)
            setOutputFile(file.absolutePath)
            prepare()
            start()
        }

        recorder = mediaRecorder
        outputFile = file
        return file
    }

    fun stop(): File? {
        val current = recorder ?: return outputFile
        runCatching {
            current.stop()
            current.reset()
            current.release()
        }
        recorder = null
        return outputFile
    }
}
