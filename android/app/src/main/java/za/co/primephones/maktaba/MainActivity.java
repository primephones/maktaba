package za.co.primephones.maktaba;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MaktabaPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** While a book is open with volume-key turning switched on, the volume keys turn pages. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (MaktabaPlugin.volumeKeysEnabled && (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                MaktabaPlugin.onVolumeKey(code == KeyEvent.KEYCODE_VOLUME_DOWN ? 1 : -1);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
