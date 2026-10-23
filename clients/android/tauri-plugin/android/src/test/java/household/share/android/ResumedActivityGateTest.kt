package household.share.android

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ResumedActivityGateTest {
    private class Owner : LifecycleOwner {
        val registry = LifecycleRegistry.createUnsafe(this)
        override val lifecycle: Lifecycle get() = registry
    }

    @Test fun latePluginLoadCatchesUpWithoutBackgroundForegroundCycle() {
        val owner = Owner()
        owner.registry.currentState = Lifecycle.State.RESUMED
        var starts = 0
        val gate = ResumedActivityGate(owner.lifecycle) { starts++ }
        gate.requireResumed("Open the app")
        assertEquals(1, starts)
        owner.registry.currentState = Lifecycle.State.STARTED
        assertThrows(IllegalStateException::class.java) { gate.requireResumed("Open the app") }
        owner.registry.currentState = Lifecycle.State.RESUMED
        gate.requireResumed("Open the app")
        assertEquals(2, starts)
    }

    @Test fun earlyLoadDoesNotStartWorkBeforeResumeOrAfterDestroy() {
        val owner = Owner()
        var starts = 0
        val gate = ResumedActivityGate(owner.lifecycle) { starts++ }
        assertThrows(IllegalStateException::class.java) { gate.requireResumed("Open the app") }
        owner.registry.currentState = Lifecycle.State.STARTED
        assertEquals(0, starts)
        assertThrows(IllegalStateException::class.java) { gate.requireResumed("Open the app") }
        owner.registry.currentState = Lifecycle.State.RESUMED
        assertEquals(1, starts)
        owner.registry.currentState = Lifecycle.State.DESTROYED
        assertThrows(IllegalStateException::class.java) { gate.requireResumed("Open the app") }
        assertEquals(0, owner.registry.observerCount)
    }

    @Test fun detachDoesNotScheduleFurtherResumes() {
        val owner = Owner()
        val gate = ResumedActivityGate(owner.lifecycle) { error("Detached observer ran") }
        gate.close()
        owner.registry.currentState = Lifecycle.State.RESUMED
        assertEquals(0, owner.registry.observerCount)
    }

    @Test fun backgroundResumeCannotChangePausedRowOrScheduleWork() {
        val owner = Owner()
        owner.registry.currentState = Lifecycle.State.STARTED
        val gate = ResumedActivityGate(owner.lifecycle) { }
        val row = Transfer(status = "paused", error = "Keep this error", retryAt = 900, attempts = 3)
        val original = row.copy()
        var schedules = 0
        assertThrows(IllegalStateException::class.java) {
            TransferControlCommand.run("resume", { gate.requireResumed("Open the app") }, {
                row.apply { status = "queued"; error = ""; retryAt = 0; attempts = 0 }
            }, { schedules++ })
        }
        assertEquals(original, row)
        assertEquals(0, schedules)

        owner.registry.currentState = Lifecycle.State.RESUMED
        TransferControlCommand.run("resume", { gate.requireResumed("Open the app") }, {
            row.apply { status = "queued"; error = ""; retryAt = 0; attempts = 0 }
        }, { schedules++ })
        assertEquals("queued", row.status)
        assertEquals(1, schedules)
    }

    @Test fun backgroundPauseAndCancelRemainAvailableWithoutStartingWork() {
        val owner = Owner()
        owner.registry.currentState = Lifecycle.State.STARTED
        val gate = ResumedActivityGate(owner.lifecycle) { }
        val row = Transfer(status = "running")
        val schedule: (Transfer) -> Unit = { error("Background control scheduled work") }
        TransferControlCommand.run("pause", { gate.requireResumed("Open the app") }, { row.apply { status = "paused" } }, schedule)
        assertEquals("paused", row.status)
        TransferControlCommand.run("cancel", { gate.requireResumed("Open the app") }, { row.apply { status = "cancelling" } }, schedule)
        assertEquals("cancelling", row.status)
    }
    @Test fun arrivalListenerStopsOnPauseAndDoesNotDuplicateLateLoad() {
        val owner = Owner()
        owner.registry.currentState = Lifecycle.State.RESUMED
        var starts = 0; var stops = 0
        val gate = ResumedActivityGate(owner.lifecycle, onPaused = { stops++ }) { starts++ }
        assertEquals(1, starts)
        owner.registry.currentState = Lifecycle.State.STARTED
        assertEquals(1, stops)
        owner.registry.currentState = Lifecycle.State.RESUMED
        assertEquals(2, starts)
        gate.close()
        assertEquals(2, stops)
        owner.registry.currentState = Lifecycle.State.STARTED
        assertEquals(2, stops)
    }
}
