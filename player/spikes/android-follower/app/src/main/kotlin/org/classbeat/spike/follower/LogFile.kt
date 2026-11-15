package org.classbeat.spike.follower

import android.content.Context
import java.io.BufferedWriter
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** One JSON-lines log in the app's own storage (`files/logs/`). Each line is flushed as it is written. */
class LogFile(context: Context, prefix: String) {
    val file: File
    private val writer: BufferedWriter

    init {
        val dir = logDir(context)
        dir.mkdirs()
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())
        file = File(dir, "$prefix-$stamp.jsonl")
        writer = file.bufferedWriter()
    }

    @Synchronized
    fun write(line: String) {
        writer.write(line)
        writer.newLine()
        writer.flush()
    }

    @Synchronized
    fun close() {
        writer.close()
    }

    companion object {
        fun logDir(context: Context): File = File(context.filesDir, "logs")
    }
}
