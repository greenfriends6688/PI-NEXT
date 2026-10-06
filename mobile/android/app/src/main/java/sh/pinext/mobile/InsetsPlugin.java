package sh.pinext.mobile;

import android.view.WindowInsets;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * fork:mobile-shell —— 把真实系统栏 insets 交给 Web 层。
 *
 * Android WebView 不通过 env(safe-area-inset-*) 暴露这些值（Chromium bug 40699457，
 * Capacitor 官方 SystemBars 文档与 MusePi 的同名插件是另外两份独立证据），即使在
 * edge-to-edge 模式下也不行。所以壳自己读 WindowInsets，换算成 CSS 像素（dp）返回，
 * JS 侧（lib/mobile-shell.ts 的 applyShellInsets）写进 --safe-top / --safe-bottom。
 */
@CapacitorPlugin(name = "Insets")
public class InsetsPlugin extends Plugin {

    @PluginMethod
    public void getSystemBars(PluginCall call) {
        WindowInsets insets = getActivity().getWindow().getDecorView().getRootWindowInsets();
        float density = getActivity().getResources().getDisplayMetrics().density;

        int top = 0;
        int bottom = 0;
        if (insets != null) {
            top = insets.getInsets(WindowInsets.Type.statusBars()).top;
            bottom = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
        }

        JSObject result = new JSObject();
        // 原生像素 → dp（CSS px），四舍五入到整值。
        result.put("top", Math.round(top / density));
        result.put("bottom", Math.round(bottom / density));
        call.resolve(result);
    }
}
