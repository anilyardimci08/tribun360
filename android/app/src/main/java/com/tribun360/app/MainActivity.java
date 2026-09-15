package com.tribun360.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Bitmap;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceResponse;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final int NOTIFICATION_REQUEST = 360;
    private WebView webView;
    private ProgressBar progress;
    private LinearLayout errorView;
    private TextView errorMessage;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean loadFailed;
    private final Runnable loadTimeout = () -> showError("Sayfa zamanında yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.");
    private float touchDownY;
    private final Uri appUri = Uri.parse(BuildConfig.TRIBUN360_URL);

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(5, 8, 13));
        getWindow().setNavigationBarColor(Color.rgb(5, 8, 13));
        buildUi();
        configureWebView();
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null
                || webView.getUrl() == null || savedInstanceState.getBoolean("loadFailed", false)) {
            retry();
        }
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(5, 8, 13));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(5, 8, 13));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(-1, dp(3));
        pp.gravity = Gravity.TOP;
        root.addView(progress, pp);

        errorView = new LinearLayout(this);
        errorView.setOrientation(LinearLayout.VERTICAL);
        errorView.setGravity(Gravity.CENTER);
        errorView.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorView.setBackgroundColor(Color.rgb(5, 8, 13));
        errorView.setVisibility(View.GONE);

        TextView ball = new TextView(this);
        ball.setText("⚽"); ball.setTextSize(48); ball.setGravity(Gravity.CENTER);
        TextView title = new TextView(this);
        title.setText("tribün360"); title.setTextColor(Color.WHITE); title.setTextSize(26); title.setGravity(Gravity.CENTER);
        TextView message = new TextView(this);
        errorMessage = message;
        message.setText("Bağlantı kurulamadı.\nİnternet bağlantınızı kontrol edip tekrar deneyin.");
        message.setTextColor(Color.LTGRAY); message.setTextSize(16); message.setGravity(Gravity.CENTER); message.setPadding(0, dp(14), 0, dp(18));
        Button retry = new Button(this);
        retry.setText("Tekrar Dene"); retry.setOnClickListener(v -> retry());
        errorView.addView(ball); errorView.addView(title); errorView.addView(message); errorView.addView(retry);
        root.addView(errorView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) s.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        webView.addJavascriptInterface(new AndroidBridge(), "Tribun360Android");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(loadFailed || newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return handleNavigation(request.getUrl());
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                beginLoading();
            }
            @Override public void onPageFinished(WebView view, String url) {
                handler.removeCallbacks(loadTimeout);
                progress.setVisibility(View.GONE);
                if (!loadFailed) webView.setVisibility(View.VISIBLE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("Bağlantı kurulamadı (" + error.getErrorCode()
                        + "). İnternet bağlantınızı kontrol edip tekrar deneyin.");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showError("Tribün360 sunucusuna ulaşıldı ancak sayfa açılamadı (HTTP "
                        + response.getStatusCode() + "). Lütfen biraz sonra tekrar deneyin.");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler sslHandler, SslError error) {
                sslHandler.cancel();
                if (error.getUrl() != null && error.getUrl().equals(view.getUrl())) {
                    showError("Güvenli bağlantı doğrulanamadı. Telefonun tarih ve saatini kontrol edin.");
                }
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> openExternal(Uri.parse(url)));
        webView.setOnTouchListener((v, event) -> {
            if (event.getAction() == MotionEvent.ACTION_DOWN) touchDownY = event.getY();
            if (event.getAction() == MotionEvent.ACTION_UP && webView.getScrollY() == 0 && event.getY() - touchDownY > dp(110)) {
                webView.reload();
                Toast.makeText(this, "Yenileniyor…", Toast.LENGTH_SHORT).show();
            }
            return false;
        });
    }

    private boolean handleNavigation(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) return true;
        if ("http".equalsIgnoreCase(scheme)) { openExternal(uri); return true; }
        if (!"https".equalsIgnoreCase(scheme)) { openExternal(uri); return true; }
        String appHost = appUri.getHost();
        String host = uri.getHost();
        if (host != null && appHost != null && host.equalsIgnoreCase(appHost)) return false;
        openExternal(uri);
        return true;
    }

    private void openExternal(Uri uri) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (Exception e) { Toast.makeText(this, "Bağlantı açılamadı", Toast.LENGTH_SHORT).show(); }
    }

    private void beginLoading() {
        loadFailed = false;
        errorView.setVisibility(View.GONE);
        progress.setProgress(0);
        progress.setVisibility(View.VISIBLE);
        handler.removeCallbacks(loadTimeout);
        handler.postDelayed(loadTimeout, 30000);
    }

    private void showError(String message) {
        loadFailed = true;
        handler.removeCallbacks(loadTimeout);
        errorMessage.setText(message);
        webView.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    private void retry() {
        webView.stopLoading();
        beginLoading();
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl(BuildConfig.TRIBUN360_URL);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        outState.putBoolean("loadFailed", loadFailed);
        super.onSaveInstanceState(outState);
    }

    @Override public void onBackPressed() {
        if (errorView.getVisibility() == View.VISIBLE) { retry(); return; }
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        webView.stopLoading();
        webView.removeJavascriptInterface("Tribun360Android");
        webView.destroy();
        super.onDestroy();
    }

    public class AndroidBridge {
        @JavascriptInterface public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST);
                }
            });
        }
        @JavascriptInterface public void share(String text, String url) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, (text == null ? "" : text) + (url == null ? "" : "\n" + url));
                startActivity(Intent.createChooser(i, "tribün360 ile paylaş"));
            });
        }
        @JavascriptInterface public String appVersion() { return BuildConfig.VERSION_NAME; }
    }
}

