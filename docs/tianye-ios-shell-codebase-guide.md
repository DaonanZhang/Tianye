# Tianye iOS Shell Codebase Guide

## Purpose

This document explains the current code inside `Tianye IOS Shell` so the project can be continued later on another computer without having to rediscover the app structure from scratch.

Codebase analyzed:

- Xcode project root: `/Users/dzsoftware/XCodeProjects/Tianye IOS Shell`
- Main app target: `Tianye IOS Shell`
- Current role: a native iPhone shell that wraps the local Django hiking playground and validates location permission, WebView loading, and simulator-based walking flows

This iOS app is not yet a full native hiking app. It is currently a lightweight SwiftUI container around the local web prototype.

## High-Level Architecture

The project is intentionally small. It has three meaningful runtime source files:

1. `Tianye_IOS_ShellApp.swift`
2. `ContentView.swift`
3. `TrailWebView.swift`

Everything else is either assets, generated Xcode project configuration, or default test scaffolding.

Current runtime flow:

1. App launches into `ContentView`
2. `ContentView` shows a full-screen `TrailWebView`
3. The WebView loads the local Django app at `http://127.0.0.1:8000`
4. A SwiftUI overlay card provides:
   - current shell title and demo description
   - editable local server URL
   - button to reconnect to a local service
   - button to request location permission
   - button to reset to default URL
   - button to open the same URL in Safari
   - current location permission state
5. A second overlay card explains simulator testing steps

Dependency classification for the current app shell:

- local web app page: `local-service`
- device location permission and position from iOS: platform runtime dependency
- no third-party SDKs: no package dependencies are configured

## File-by-File Breakdown

### 1. `Tianye_IOS_ShellApp.swift`

Responsibility:

- app entry point
- creates the only `WindowGroup`
- injects `ContentView` as the root UI

Important point:

- there is no app-wide dependency container, routing layer, persistence layer, or shared state object yet

Implication for future work:

- if the app becomes more native, this file is the natural place to wire environment objects such as route state, gear checklist state, offline map state, and on-device hike session state

### 2. `ContentView.swift`

This is the real core of the current app.

Responsibilities:

- stores the editable shell URL string
- stores the currently committed URL that the WebView should load
- creates and owns a `LocationPermissionManager`
- renders the visual shell overlay on top of the WebView
- normalizes user-entered URLs before loading them
- requests location permission from iOS
- displays the current authorization status

State currently used:

- `locationPermissionManager`
- `shellURLString`
- `committedURL`

Main UI composition:

- background layer: `TrailWebView(url: committedURL)`
- dark gradient overlay for readability
- top/bottom card stack rendered with SwiftUI

Main user actions:

- `连接本地服务`
  - takes the string from the text field
  - normalizes it through `ShellConfiguration.normalizedURL(from:)`
  - reloads the WebView with the resulting URL
- `申请定位权限`
  - calls `requestWhenInUse()` on `LocationPermissionManager`
- `切回默认地址`
  - resets the URL to `http://127.0.0.1:8000`
- `Safari 打开`
  - opens the same currently committed URL outside the shell

Visual design direction already present:

- the shell is not using default plain iOS widgets only
- it already has a soft commercial-demo look:
  - translucent dark cards
  - rounded pills
  - hiking-oriented copy
  - simulator guidance directly in the UI

This matters because the code is already aligned with the product direction described in the iOS shell `TODO.md`: a light-hiking commercial demo, not a developer-only browser wrapper.

### 3. `ShellConfiguration` inside `ContentView.swift`

Responsibility:

- defines the shell default URL
- ensures manually entered host strings can still become valid URLs

Current logic:

- default URL: `http://127.0.0.1:8000`
- trims whitespace
- returns default URL for empty input
- if input already contains a scheme, use it directly
- otherwise prepend `http://`

Why this matters:

- on another computer, the local Django server address may change
- this helper is what keeps the shell flexible without requiring rebuilds for every host/port change

### 4. `LocationPermissionManager` inside `ContentView.swift`

Responsibility:

- wraps `CLLocationManager`
- tracks the current authorization state
- exposes a human-readable Chinese status string for the UI
- requests when-in-use location access

Important behavior:

- authorization state is primed on `onAppear`
- state updates when iOS authorization changes
- the shell currently requests permission, but it does not itself consume live location coordinates in native Swift code

Important limitation:

- the location stream is still expected to be used by the web app loaded inside the WebView, not by native SwiftUI views

That means the current shell has native permission control, but not yet native navigation logic.

### 5. `TrailWebView.swift`

Responsibility:

- wraps `WKWebView` in SwiftUI through `UIViewRepresentable`
- loads the current URL
- allows JavaScript
- allows media playback without extra user action
- disables automatic content inset adjustments
- prints navigation errors to console

Current implementation details:

- `makeUIView` builds the `WKWebView`
- `updateUIView` reloads only when the URL actually changes
- a nested `Coordinator` acts as `WKNavigationDelegate`
- failures are only logged with `print`

Important limitation:

- there is no structured error UI if the Django server is offline
- there is no loading state indicator
- there is no message bridge between JavaScript and native Swift
- there is no native interception of GPS, route progress, or offline assets yet

This file is the exact seam where the project can later evolve from "WebView shell" into a more integrated hybrid app.

## Current Product Behavior

What the app can do today:

- launch as a native iPhone app
- load the local Django hiking playground in a full-screen WebView
- let the user manually point the shell to a different local URL
- request and display location permission state
- support local-network style development use cases
- support simulator validation for location flows

What the app does not do yet:

- native MapKit map rendering
- native GPX import
- native route drawing
- native walked-distance and remaining-distance computation
- native offline path storage
- native gear checklist flow
- native hike session persistence
- background location handling
- resilient error handling for server connection failures

## Xcode Project Configuration

From `project.pbxproj`, the project currently has these notable settings:

- app target name: `Tianye IOS Shell`
- unit test target: `Tianye IOS ShellTests`
- UI test target: `Tianye IOS ShellUITests`
- Swift version: `5.0`
- marketing version: `1.0`
- current project version: `1`
- bundle identifier: `Tianye.Tianye-IOS-Shell`
- generated Info.plist: enabled

Important runtime permissions and transport settings:

- `NSLocationWhenInUseUsageDescription` is already configured
- `NSAppTransportSecurity_NSAllowsLocalNetworking = YES`
- `NSAppTransportSecurity_NSAllowsArbitraryLoadsInWebContent = YES`

Why these settings matter:

- local Django development would be painful without local networking allowance
- the app is designed specifically to load non-production local content during the shell phase
- location permission text is already present, so the app can request positioning permission without extra Info.plist edits

## Testing Status

The test targets exist, but they are still template-level scaffolding.

Current reality:

- unit test file contains only an empty example test
- UI test file launches the app but does not verify app-specific behavior
- launch test only captures a screenshot after startup

So, from a maintenance perspective:

- there is effectively no meaningful automated coverage yet

## Relationship to the Django Prototype

This app depends on the Django playground as its current feature engine.

Practical relationship:

- iOS shell owns the native container, permission prompt, and basic mobile presentation
- Django app owns the actual hiking demo behavior rendered inside the WebView

This means feature ownership is currently split like this:

- native iOS shell:
  - app lifecycle
  - location permission request
  - host URL switching
  - iPhone container UI
- Django web prototype:
  - actual map page
  - route preview logic
  - GPX and path workflows already being prototyped upstream
  - walking simulation behavior displayed inside the page

This is useful for future development because it clarifies the migration path:

1. keep validating interaction ideas quickly in Django
2. move stable hiking logic into portable app-owned structures
3. gradually replace WebView dependency with native or hybrid on-device logic

## Immediate Technical Risks

### 1. Heavy dependency on a running local server

If `http://127.0.0.1:8000` is not running, the shell has little value beyond showing a failed WebView load.

### 2. No native fallback state

The app does not show a dedicated offline, disconnected, or bootstrapping screen.

### 3. No JS-native bridge yet

If future work needs tight integration between the web layer and native layer, `WKScriptMessageHandler` or another bridge will need to be added.

### 4. Native location logic is not implemented yet

Permission exists, but native coordinate handling, map matching, route progress, and on-device hike state are not yet present in Swift.

### 5. No packaging of local route/map data in the iOS project

The shell currently consumes a local service. It does not yet own local map or trail datasets as app assets.

## Recommended Next Development Steps

If you continue this project on another computer, the cleanest order is:

1. Recreate the Django playground first
   - ensure the local server can run and serve the current hiking page
   - verify the shell can still connect to the same endpoint

2. Open the Xcode project and confirm simulator flow
   - build the app
   - allow location permission
   - verify that changing the URL reloads the WebView correctly

3. Add proper WebView error and loading states
   - show a user-facing message when the local page cannot be loaded
   - expose a retry action

4. Add a JS-native bridge
   - let the web app send events such as route loaded, hike started, hike finished, or off-route detected
   - let native code push location or app state down if needed

5. Start moving core hiking logic out of the WebView dependency
   - first candidates:
     - hike session state
     - route progress model
     - walked distance and remaining distance computation
     - GPX file handling

6. Move toward offline-first mobile ownership
   - package trail data, saved paths, or derived route assets locally
   - reduce dependence on live localhost services for core demo flows

## Suggested Future Module Split

When the shell becomes a more real app, a likely structure is:

- `App`
  - app bootstrap
  - environment objects
- `Features/Shell`
  - current WebView shell
  - local server connection state
- `Features/Hike`
  - hike session state
  - route progress
  - off-route detection
- `Features/Gear`
  - owned gear
  - carried gear selection
- `Infrastructure/Location`
  - live location stream
  - permission handling
- `Infrastructure/WebBridge`
  - JS-native bridge and message contracts
- `Data/Routes`
  - bundled paths
  - GPX imports
  - local persistence

That split fits the product direction in both project `AGENTS.md` files: mobile-first, offline-first, and gradually moving core hiking capability onto the device.

## Short Summary

`Tianye IOS Shell` is currently a clean and minimal SwiftUI wrapper around the local Django hiking prototype. Its real value today is not feature completeness, but the fact that it already proves three important things:

- the hiking prototype can be put inside an iPhone-shaped runtime
- native location permission can be handled at the app layer
- simulator-based walking validation can happen before a full native rewrite

If you resume work later, treat this codebase as a transitional mobile shell, not as the final architecture. The next milestone should be reducing WebView dependence and moving core hiking state and offline path capabilities into native app-owned modules.
