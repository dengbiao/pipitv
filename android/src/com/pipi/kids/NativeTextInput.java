package com.pipi.kids;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.text.InputFilter;
import android.text.InputType;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.LinearLayout;

/** Let the installed TV IME own text composition and all of its remote keys. */
final class NativeTextInput {
    interface Result { void finish(String value); }
    private AlertDialog dialog;
    boolean isOpen() { return dialog != null; }
    void cancel() { if (dialog != null) dialog.cancel(); }
    void show(Activity activity, String label, String value, int limit, Result callback) {
        cancel();
        EditText input = new EditText(activity) {
            private boolean keyboardRequested;
            @Override public void onWindowFocusChanged(boolean focused) {
                super.onWindowFocusChanged(focused);
                if (focused && !keyboardRequested) post(() -> {
                    if (!keyboardRequested && isAttachedToWindow() && hasFocus()) {
                        keyboardRequested = true;
                        // This is an explicit OK action. IMPLICIT is suppressed by TV hardware-keyboard detection.
                        ((InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(this, 0);
                    }
                });
            }
        };
        input.setTextSize(22); input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);
        input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(Math.max(1, Math.min(limit, 100)))});
        input.setText(value); input.setSelectAllOnFocus(true);
        LinearLayout content = new LinearLayout(activity);
        int padding = (int) (24 * activity.getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding / 2, padding, padding / 2);
        content.addView(input, new LinearLayout.LayoutParams(-1, -2));
        AlertDialog next = new AlertDialog.Builder(activity).setTitle(label).setView(content)
            .setNegativeButton("取消", (button, which) -> {})
            .setPositiveButton("完成", (button, which) -> {}) .create();
        dialog = next;
        final boolean[] done = {false};
        final String[] result = {null};
        Runnable confirm = () -> { result[0] = input.getText().toString(); next.dismiss(); };
        next.setOnDismissListener(button -> {
            if (dialog == next) dialog = null;
            ((InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(), 0);
            if (!done[0]) { done[0] = true; callback.finish(result[0]); }
        });
        next.setOnShowListener(button -> {
            next.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> confirm.run());
            input.requestFocus();
        });
        input.setOnEditorActionListener((view, action, event) -> {
            if (action != EditorInfo.IME_ACTION_DONE) return false;
            confirm.run(); return true;
        });
        next.setCanceledOnTouchOutside(false);
        next.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        next.show();
    }
}
