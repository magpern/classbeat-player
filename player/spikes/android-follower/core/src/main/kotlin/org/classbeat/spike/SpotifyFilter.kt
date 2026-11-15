package org.classbeat.spike

/** Spotify's Android package. Only sessions from this package are ever read (ADR 0011 section 6). */
const val SPOTIFY_PACKAGE = "com.spotify.music"

fun isSpotify(packageName: String?): Boolean = packageName == SPOTIFY_PACKAGE

/**
 * Keeps only Spotify's sessions. It takes the package name from each item and nothing else, so the
 * caller can filter the system's active sessions before it reads any metadata or playback state.
 */
fun <T> spotifyOnly(items: List<T>, packageName: (T) -> String?): List<T> =
    items.filter { isSpotify(packageName(it)) }
