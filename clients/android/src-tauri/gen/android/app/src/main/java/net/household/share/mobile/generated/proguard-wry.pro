# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class net.household.share.mobile.* {
  native <methods>;
}

-keep class net.household.share.mobile.WryActivity {
  public <init>(...);

  void setWebView(net.household.share.mobile.RustWebView);
  java.lang.Class getAppClass(...);
  int getId();
  java.lang.String getVersion();
  int startActivity(...);
}

-keep class net.household.share.mobile.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class net.household.share.mobile.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class net.household.share.mobile.RustWebChromeClient,net.household.share.mobile.RustWebViewClient {
  public <init>(...);
}
