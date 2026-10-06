package sh.pinext.mobile;

import android.os.Bundle;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * fork:mobile-shell —— 壳的 Activity（照 MusePi 已验证的形状，坑都注明）。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin 必须在 super.onCreate() 之前：bridge 是在 super 里构建的，
        // 插件在那一刻加载；放后面注册的自定义插件 JS 侧永远找不到（MusePi 注释原文）。
        registerPlugin(InsetsPlugin.class);
        super.onCreate(savedInstanceState);

        // edge-to-edge：页面自己用 --safe-* 消化状态栏/手势条（globals.css + InsetsPlugin），
        // 不让 decor 再垫一层。targetSdk 35+ 下不声明这句，WebView 会被压进系统栏。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, insets) ->
            WindowInsetsCompat.CONSUMED);
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
