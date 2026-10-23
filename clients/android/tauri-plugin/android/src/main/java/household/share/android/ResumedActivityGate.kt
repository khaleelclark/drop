package household.share.android

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

/** Attach and check on the UI thread. A late observer receives the current resume event. */
internal class ResumedActivityGate(
    private val lifecycle: Lifecycle,
    private val onPaused: () -> Unit = {},
    private val onResumed: () -> Unit,
) : DefaultLifecycleObserver, AutoCloseable {
    init { lifecycle.addObserver(this) }

    fun requireResumed(message: String) {
        check(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) { message }
    }

    override fun onResume(owner: LifecycleOwner) { onResumed() }
    override fun onPause(owner: LifecycleOwner) { onPaused() }
    override fun onDestroy(owner: LifecycleOwner) { close() }
    override fun close() { lifecycle.removeObserver(this); onPaused() }
}
