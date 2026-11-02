# References and attribution

PIPI Remote is a small Java Android implementation for local Bluetooth mouse and keyboard input.

The conventional combined HID descriptor and report format were informed by:

- Linkpad by Devdas Kumar, MIT licensed: https://github.com/Devdas-gupta/linkpad
- Inspected descriptor blob: `04c293cbf9195b06ddd4fea53a67c67af8d40bd3`
- Inspected report sender blob: `691be914a895580696a21efc84b28fb026d03086`
- Inspected connection service blob: `d5957f7bbede6c76b74d2495a99b22c85c927368`

The Linkpad license is included in `licenses/Linkpad-MIT.txt` and in the APK assets.
This application uses a smaller, four-byte mouse report and implements its own Java UI, gestures, lifecycle, connection handling, and tests.

Android API references:

- https://developer.android.com/reference/android/bluetooth/BluetoothHidDevice
- https://developer.android.com/develop/connectivity/bluetooth/bt-permissions

No third-party executable library or advertising SDK is bundled.
