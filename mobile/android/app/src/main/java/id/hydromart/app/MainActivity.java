package id.hydromart.app;

import android.Manifest;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.util.PermissionHelper;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    /**
     * J1 — geolocation was dead on the customer build, on every Android below 12.
     *
     * Capacitor's own `BridgeWebChromeClient.onGeolocationPermissionsShowPrompt` asks for
     * `{ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION}` and treats anything short of BOTH as a
     * refusal. Its one escape hatch — "coarse alone is enough" — is guarded by
     * `SDK_INT >= S`, so it never runs on Android 11 and below.
     *
     * The customer binary strips `ACCESS_FINE_LOCATION` out of the merged manifest
     * (`build.gradle`, and deliberately: the Play declaration says Approximate location).
     * A permission that is not declared is denied by the system instantly and WITHOUT a
     * dialog — so the aggregate is false, the SDK 31 escape hatch is closed, the callback is
     * invoked with `false`, and the WebView reports code 1. `lib/geo.ts` maps code 1 to
     * 'denied' and refuses to retry, correctly: a real refusal cannot be retried into a yes.
     * Here the refusal was manufactured by the manifest, not by the person holding the phone.
     *
     * Measured on an OPPO CPH2209, Android 11 (API 30), app 1.4.0: `dumpsys package` lists
     * only ACCESS_COARSE_LOCATION as requested, already `granted=true`, and tapping
     * "Gunakan lokasi saya" failed instantly with no permission dialog at all.
     *
     * The fix backports that escape hatch below Android 12, and asks only for the
     * permissions this binary actually DECLARES:
     *
     *  - customer build: coarse alone — which is all "find my nearest depot" ever needed,
     *    and all the Data Safety form promises. Nothing changes for Play: the manifest is
     *    untouched and the declaration stays Approximate location.
     *  - ops build: both, unchanged, so courier tracking keeps its precise fix. It also
     *    gains the Android 12+ case where the user picks "Approximate" in the dialog —
     *    coarse-only used to read as a refusal there too on this path.
     *
     * Fixing this in `geo.ts` is not possible: once the WebView has answered `false` for an
     * origin it keeps answering `false` without re-prompting, so a JS-side retry gets code 1
     * again. The gate is native, so the fix is native.
     */
    private static final class GeolocationWebChromeClient extends BridgeWebChromeClient {

        private final Bridge bridge;
        private final ActivityResultLauncher<String[]> request;
        private GeolocationPermissions.Callback pending;
        private String pendingOrigin;

        GeolocationWebChromeClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
            // Must be registered while the activity is still CREATED — hence onCreate, not onStart.
            this.request = bridge.registerForActivityResult(
                new ActivityResultContracts.RequestMultiplePermissions(),
                (Map<String, Boolean> result) -> answer(result.containsValue(true))
            );
        }

        /** The subset of {coarse, fine} this binary declares. Never empty in either build. */
        private String[] declaredGeoPermissions() {
            List<String> declared = new ArrayList<>(2);
            for (String permission : new String[] {
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION
            }) {
                if (PermissionHelper.hasDefinedPermission(bridge.getContext(), permission)) {
                    declared.add(permission);
                }
            }
            return declared.toArray(new String[0]);
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            String[] declared = declaredGeoPermissions();
            if (declared.length == 0) {
                callback.invoke(origin, false, false);
                return;
            }
            // Any one of them granted is a position — coarse is enough to pick a depot.
            for (String permission : declared) {
                if (PermissionHelper.hasPermissions(bridge.getContext(), new String[] { permission })) {
                    callback.invoke(origin, true, false);
                    return;
                }
            }
            pendingOrigin = origin;
            pending = callback;
            request.launch(declared);
        }

        private void answer(boolean granted) {
            if (pending == null) {
                return;
            }
            GeolocationPermissions.Callback callback = pending;
            String origin = pendingOrigin;
            pending = null;
            pendingOrigin = null;
            callback.invoke(origin, granted, false);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.getWebView().setWebChromeClient(new GeolocationWebChromeClient(bridge));
    }
}
