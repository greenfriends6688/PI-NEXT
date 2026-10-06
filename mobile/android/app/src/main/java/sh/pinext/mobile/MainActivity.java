package sh.pinext.mobile;

import android.os.Bundle;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

/**
 * fork:mobile-shell —— 壳的 Activity。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin 必须在 super.onCreate() 之前：bridge 是在 super 里构建的，
        // 插件在那一刻加载；放后面注册的自定义插件 JS 侧永远找不到（MusePi 注释原文）。
        registerPlugin(InsetsPlugin.class);
        super.onCreate(savedInstanceState);

        // edge-to-edge：让 WebView 画到系统栏下面，安全区交给页面消化。
        // **不要**在这里 setOnApplyWindowInsetsListener(CONSUMED)——Capacitor 8 内置的
        // SystemBars 插件靠 WebView 自己的 insets 监听把真实安全区注入成
        // --safe-area-inset-* CSS 变量（SystemBars.java:242 injectSafeAreaCSS），
        // 在 decorView 层把 insets 消费掉会饿死它，页面就顶进状态栏（2026-10-06 实测）。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Android 12+ 的 SplashScreen 会在 onCreate 之后把 decor-fit 恢复回去，
        // 所以拿到焦点时要再断言一次（MusePi 实测坑）。
        if (hasFocus) {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        }
    }
}
