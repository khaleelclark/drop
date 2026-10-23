package net.household.share.mobile

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    household.share.android.ArrivalPermission.result(this, requestCode)
  }

  override fun onDestroy() {
    household.share.android.ArrivalPermission.destroyed(this)
    super.onDestroy()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
