package household.share.android

/** Run synchronously on the UI thread so Activity pause cannot interleave the Resume mutation/start. */
internal object TransferControlCommand {
    fun run(
        action: String,
        requireVisible: () -> Unit,
        change: () -> Transfer,
        schedule: (Transfer) -> Unit,
    ): Transfer {
        if (action == "resume") requireVisible()
        val changed = change()
        if (action == "resume") {
            requireVisible()
            schedule(changed)
        } else if (action == "cancel" && runCatching { requireVisible() }.isSuccess) {
            // Cancelling persisted work remains allowed while backgrounded; starting cleanup does not.
            schedule(changed)
        }
        return changed
    }
}
