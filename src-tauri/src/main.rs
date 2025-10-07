// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod native_widget;

use tauri::{CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent, Window};
use std::collections::HashMap;
use serde_json::json;

#[tauri::command]
async fn start_google_oauth(window: Window) -> Result<u16, String> {
    use warp::Filter;
    
    println!("🔐 Starting Google OAuth with local callback server...");
    
    // Load environment variables
    dotenv::dotenv().ok();
    
    // Get Supabase URL from environment
    let supabase_url = std::env::var("SUPABASE_URL")
        .unwrap_or_else(|_| "https://bvwgycgdmrozxfmyxpuy.supabase.co".to_string());
    
    // Find available port
    let port = find_available_port().unwrap_or(8080);
    let callback_url = format!("http://localhost:{}/callback", port);
    
    // Build OAuth URL with local callback and force account selection
    let oauth_url = format!(
        "{}/auth/v1/authorize?provider=google&redirect_to={}&prompt=select_account",
        supabase_url,
        urlencoding::encode(&callback_url)
    );
    
    println!("🔐 OAuth URL: {}", oauth_url);
    println!("🔐 Callback URL: {}", callback_url);
    
    // Clone window for use in callback
    let window_clone = window.clone();
    
    // Start local server to handle OAuth callback
    let callback_route = warp::path("callback")
        .and(warp::query::<HashMap<String, String>>())
        .map(move |params: HashMap<String, String>| {
            let window = window_clone.clone();
            
            println!("🔐 Received OAuth callback with params: {:?}", params);
            
            // Check for error
            if let Some(error) = params.get("error") {
                let error_desc = params.get("error_description").unwrap_or(error);
                println!("❌ OAuth error: {} - {}", error, error_desc);
                
                let _ = window.emit("auth:error", json!({
                    "error": error,
                    "error_description": error_desc
                }));
                
                return warp::reply::html(format!(
                    "<html><body><h1>Authentication Failed</h1><p>{}</p><script>setTimeout(() => window.close(), 3000);</script></body></html>",
                    error_desc
                ));
            }
            
            // Check for authorization code
            if let Some(code) = params.get("code") {
                println!("✅ Received authorization code: {}...", &code[..std::cmp::min(10, code.len())]);
                
                // For Supabase OAuth, we need to let the frontend handle the code exchange
                // since it has the proper Supabase client configuration
                let _ = window.emit("auth:success", json!({
                    "code": code,
                    "state": params.get("state")
                }));
                
                return warp::reply::html(
                    "<html><body><h1>Authentication Successful!</h1><p>You can close this window.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>".to_string()
                );
            }
            
            // Handle direct token response (implicit flow)
            if let Some(access_token) = params.get("access_token") {
                println!("✅ Received access token directly");
                
                let _ = window.emit("auth:success", json!({
                    "access_token": access_token,
                    "refresh_token": params.get("refresh_token"),
                    "token_type": params.get("token_type")
                }));
                
                return warp::reply::html(
                    "<html><body><h1>Authentication Successful!</h1><p>You can close this window.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>".to_string()
                );
            }
            
            // For implicit flow, tokens are in URL fragment, not query params
            // Return HTML with JavaScript to extract fragment and send to Tauri
            warp::reply::html(format!(
                r#"<html><body>
                <h1>Processing Authentication...</h1>
                <script>
                    console.log('🔐 Processing OAuth callback...');
                    console.log('🔐 URL:', window.location.href);
                    console.log('🔐 Hash:', window.location.hash);
                    
                    // Parse URL fragment for tokens (implicit flow)
                    const hashParams = new URLSearchParams(window.location.hash.substring(1));
                    const accessToken = hashParams.get('access_token');
                    const refreshToken = hashParams.get('refresh_token');
                    const tokenType = hashParams.get('token_type');
                    const error = hashParams.get('error');
                    
                    console.log('🔐 Fragment params:', {{
                        accessToken: accessToken ? 'present' : 'missing',
                        refreshToken: refreshToken ? 'present' : 'missing',
                        tokenType: tokenType,
                        error: error
                    }});
                    
                    if (error) {{
                        console.error('❌ OAuth error in fragment:', error);
                        fetch('/error?error=' + encodeURIComponent(error));
                        document.body.innerHTML = '<h1>Authentication Failed</h1><p>' + error + '</p>';
                        setTimeout(() => window.close(), 3000);
                    }} else if (accessToken) {{
                        console.log('✅ Found tokens in URL fragment, sending to server...');
                        // Send tokens to our server endpoint
                        fetch('/tokens?access_token=' + encodeURIComponent(accessToken) + 
                              '&refresh_token=' + encodeURIComponent(refreshToken || '') +
                              '&token_type=' + encodeURIComponent(tokenType || ''))
                        .then(() => {{
                            document.body.innerHTML = '<h1>Authentication Successful!</h1><p>You can close this window.</p>';
                            setTimeout(() => window.close(), 2000);
                        }});
                    }} else {{
                        console.log('❌ No tokens found in URL fragment');
                        document.body.innerHTML = '<h1>Authentication Error</h1><p>No tokens received.</p>';
                    }}
                </script>
                </body></html>"#
            ))
        });
    
    // Add tokens endpoint to handle implicit flow tokens
    let window_clone2 = window.clone();
    let tokens_route = warp::path("tokens")
        .and(warp::query::<HashMap<String, String>>())
        .map(move |params: HashMap<String, String>| {
            let window = window_clone2.clone();
            
            println!("🔐 Received tokens from JavaScript: {:?}", params);
            
            if let Some(access_token) = params.get("access_token") {
                println!("✅ Processing access token from fragment");
                
                let _ = window.emit("auth:success", json!({
                    "access_token": access_token,
                    "refresh_token": params.get("refresh_token"),
                    "token_type": params.get("token_type")
                }));
            }
            
            warp::reply::html("OK".to_string())
        });
    
    // Combine routes
    let routes = callback_route.or(tokens_route);
    
    // Start server in background
    let server_port = port;
    tokio::spawn(async move {
        println!("🔐 Starting OAuth callback server on port {}", server_port);
        warp::serve(routes)
            .run(([127, 0, 0, 1], server_port))
            .await;
    });
    
    // Give server time to start
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // Open browser for OAuth
    open::that(oauth_url).map_err(|e| e.to_string())?;
    
    Ok(port)
}

// Apple OAuth flow: mirrors Google flow but uses provider=apple
#[tauri::command]
async fn start_apple_oauth(window: Window) -> Result<u16, String> {
    use warp::Filter;

    println!("🔐 Starting Apple OAuth with local callback server...");

    dotenv::dotenv().ok();

    let supabase_url = std::env::var("SUPABASE_URL")
        .unwrap_or_else(|_| "https://bvwgycgdmrozxfmyxpuy.supabase.co".to_string());

    let port = find_available_port().unwrap_or(8080);
    let callback_url = format!("http://localhost:{}/callback", port);

    // Use the Apple provider key for Supabase
    let oauth_url = format!(
        "{}/auth/v1/authorize?provider=apple&redirect_to={}",
        supabase_url,
        urlencoding::encode(&callback_url)
    );

    println!("🔐 OAuth URL (Apple): {}", oauth_url);
    println!("🔐 Callback URL (Apple): {}", callback_url);

    let window_clone = window.clone();

    let callback_route = warp::path("callback")
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .map(move |params: std::collections::HashMap<String, String>| {
            let window = window_clone.clone();

            println!("🔐 Received OAuth callback (Apple) with params: {:?}", params);

            if let Some(error) = params.get("error") {
                let error_desc = params.get("error_description").unwrap_or(error);
                println!("❌ OAuth error (Apple): {} - {}", error, error_desc);

                let _ = window.emit("auth:error", serde_json::json!({
                    "error": error,
                    "error_description": error_desc
                }));

                return warp::reply::html(format!(
                    "<html><body><h1>Authentication Failed</h1><p>{}</p><script>setTimeout(() => window.close(), 3000);</script></body></html>",
                    error_desc
                ));
            }

            if let Some(code) = params.get("code") {
                println!("✅ Received authorization code (Apple): {}...", &code[..std::cmp::min(10, code.len())]);
                let _ = window.emit("auth:success", serde_json::json!({
                    "code": code,
                    "state": params.get("state")
                }));
                return warp::reply::html(
                    "<html><body><h1>Authentication Successful!</h1><p>You can close this window.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>".to_string()
                );
            }

            if let Some(access_token) = params.get("access_token") {
                println!("✅ Received access token directly (Apple)");
                let _ = window.emit("auth:success", serde_json::json!({
                    "access_token": access_token,
                    "refresh_token": params.get("refresh_token"),
                    "token_type": params.get("token_type")
                }));
                return warp::reply::html(
                    "<html><body><h1>Authentication Successful!</h1><p>You can close this window.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>".to_string()
                );
            }

            warp::reply::html(format!(
                r#"<html><body>
                <h1>Processing Authentication...</h1>
                <script>
                    const hashParams = new URLSearchParams(window.location.hash.substring(1));
                    const accessToken = hashParams.get('access_token');
                    const refreshToken = hashParams.get('refresh_token');
                    const tokenType = hashParams.get('token_type');
                    const error = hashParams.get('error');
                    if (error) {{
                        fetch('/error?error=' + encodeURIComponent(error));
                        document.body.innerHTML = '<h1>Authentication Failed</h1><p>' + error + '</p>';
                        setTimeout(() => window.close(), 3000);
                    }} else if (accessToken) {{
                        fetch('/tokens?access_token=' + encodeURIComponent(accessToken) +
                              '&refresh_token=' + encodeURIComponent(refreshToken || '') +
                              '&token_type=' + encodeURIComponent(tokenType || ''))
                        .then(() => {{
                            document.body.innerHTML = '<h1>Authentication Successful!</h1><p>You can close this window.</p>';
                            setTimeout(() => window.close(), 2000);
                        }});
                    }} else {{
                        document.body.innerHTML = '<h1>Authentication Error</h1><p>No tokens received.</p>';
                    }}
                </script>
                </body></html>"#
            ))
        });

    let window_clone2 = window.clone();
    let tokens_route = warp::path("tokens")
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .map(move |params: std::collections::HashMap<String, String>| {
            let window = window_clone2.clone();
            println!("🔐 Received tokens from JavaScript (Apple): {:?}", params);
            if let Some(access_token) = params.get("access_token") {
                let _ = window.emit("auth:success", serde_json::json!({
                    "access_token": access_token,
                    "refresh_token": params.get("refresh_token"),
                    "token_type": params.get("token_type")
                }));
            }
            warp::reply::html("OK".to_string())
        });

    let routes = callback_route.or(tokens_route);

    let server_port = port;
    tokio::spawn(async move {
        println!("🔐 Starting OAuth callback server (Apple) on port {}", server_port);
        warp::serve(routes)
            .run(([127, 0, 0, 1], server_port))
            .await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    open::that(oauth_url).map_err(|e| e.to_string())?;

    Ok(port)
}

// X/Twitter OAuth flow: mirrors Google flow but uses provider=twitter
#[tauri::command]
async fn start_x_oauth(window: Window) -> Result<u16, String> {
    use warp::Filter;

    println!("🔐 Starting X (Twitter) OAuth with local callback server...");

    dotenv::dotenv().ok();

    let supabase_url = std::env::var("SUPABASE_URL")
        .unwrap_or_else(|_| "https://bvwgycgdmrozxfmyxpuy.supabase.co".to_string());

    let port = find_available_port().unwrap_or(8080);
    let callback_url = format!("http://localhost:{}/callback", port);

    // Use the Twitter provider key for Supabase
    let oauth_url = format!(
        "{}/auth/v1/authorize?provider=twitter&redirect_to={}",
        supabase_url,
        urlencoding::encode(&callback_url)
    );

    println!("🔐 OAuth URL (X): {}", oauth_url);
    println!("🔐 Callback URL (X): {}", callback_url);

    let window_clone = window.clone();

    let callback_route = warp::path("callback")
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .map(move |params: std::collections::HashMap<String, String>| {
            let window = window_clone.clone();

            println!("🔐 Received OAuth callback (X) with params: {:?}", params);

            if let Some(error) = params.get("error") {
                let error_desc = params.get("error_description").unwrap_or(error);
                println!("❌ OAuth error (X): {} - {}", error, error_desc);

                let _ = window.emit("auth:error", serde_json::json!({
                    "error": error,
                    "error_description": error_desc
                }));

                return warp::reply::html(format!(
                    "<html><body><h1>Authentication Failed</h1><p>{}</p><script>setTimeout(() => window.close(), 3000);</script></body></html>",
                    error_desc
                ));
            }

            if let Some(code) = params.get("code") {
                println!("✅ Received authorization code (X): {}...", &code[..std::cmp::min(10, code.len())]);
                let _ = window.emit("auth:success", serde_json::json!({
                    "code": code,
                    "state": params.get("state")
                }));
                return warp::reply::html(
                    "<html><body><h1>Authentication Successful!</h1><p>You can close this window.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>".to_string()
                );
            }

            if let Some(access_token) = params.get("access_token") {
                println!("✅ Received access token directly (X)");
                let _ = window.emit("auth:success", serde_json::json!({
                    "access_token": access_token,
                    "refresh_token": params.get("refresh_token"),
                    "token_type": params.get("token_type")
                }));
                return warp::reply::html(
                    "<html><body><h1>Authentication Successful!</h1><p>You can close this window.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>".to_string()
                );
            }

            warp::reply::html(format!(
                r#"<html><body>
                <h1>Processing Authentication...</h1>
                <script>
                    const hashParams = new URLSearchParams(window.location.hash.substring(1));
                    const accessToken = hashParams.get('access_token');
                    const refreshToken = hashParams.get('refresh_token');
                    const tokenType = hashParams.get('token_type');
                    const error = hashParams.get('error');
                    if (error) {{
                        fetch('/error?error=' + encodeURIComponent(error));
                        document.body.innerHTML = '<h1>Authentication Failed</h1><p>' + error + '</p>';
                        setTimeout(() => window.close(), 3000);
                    }} else if (accessToken) {{
                        fetch('/tokens?access_token=' + encodeURIComponent(accessToken) +
                              '&refresh_token=' + encodeURIComponent(refreshToken || '') +
                              '&token_type=' + encodeURIComponent(tokenType || ''))
                        .then(() => {{
                            document.body.innerHTML = '<h1>Authentication Successful!</h1><p>You can close this window.</p>';
                            setTimeout(() => window.close(), 2000);
                        }});
                    }} else {{
                        document.body.innerHTML = '<h1>Authentication Error</h1><p>No tokens received.</p>';
                    }}
                </script>
                </body></html>"#
            ))
        });

    let window_clone2 = window.clone();
    let tokens_route = warp::path("tokens")
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .map(move |params: std::collections::HashMap<String, String>| {
            let window = window_clone2.clone();
            println!("🔐 Received tokens from JavaScript (X): {:?}", params);
            if let Some(access_token) = params.get("access_token") {
                let _ = window.emit("auth:success", serde_json::json!({
                    "access_token": access_token,
                    "refresh_token": params.get("refresh_token"),
                    "token_type": params.get("token_type")
                }));
            }
            warp::reply::html("OK".to_string())
        });

    let routes = callback_route.or(tokens_route);

    let server_port = port;
    tokio::spawn(async move {
        println!("🔐 Starting OAuth callback server (X) on port {}", server_port);
        warp::serve(routes)
            .run(([127, 0, 0, 1], server_port))
            .await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    open::that(oauth_url).map_err(|e| e.to_string())?;

    Ok(port)
}

fn find_available_port() -> Option<u16> {
    use std::net::{TcpListener, SocketAddr};
    
    for port in 8080..8090 {
        let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().ok()?;
        if TcpListener::bind(addr).is_ok() {
            return Some(port);
        }
    }
    None
}

fn main() {
  // Create system tray menu
  let quit = CustomMenuItem::new("quit".to_string(), "Quit");
  let show_widget = CustomMenuItem::new("show_widget".to_string(), "Show Focus Timer");
  let tray_menu = SystemTrayMenu::new()
    .add_item(show_widget)
    .add_item(quit);
  
  let system_tray = SystemTray::new().with_menu(tray_menu);

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![start_google_oauth, start_apple_oauth, start_x_oauth, native_widget::create_native_timer_widget, native_widget::close_native_timer_widget, native_widget::write_auth_token_to_file, native_widget::check_dashboard_refresh_trigger, native_widget::show_native_microphone_permission_dialog, native_widget::check_native_microphone_permission, native_widget::start_native_speech_recognition, native_widget::stop_native_speech_recognition])
    .system_tray(system_tray)
    .on_system_tray_event(|_app, event| match event {
      SystemTrayEvent::LeftClick {
        position: _,
        size: _,
        ..
      } => {
        // Create native Swift timer widget from system tray
        println!("🖱️ System tray clicked - creating native Swift timer widget");
        native_widget::create_native_timer_widget();
      }
      SystemTrayEvent::MenuItemClick { id, .. } => {
        match id.as_str() {
          "quit" => {
            std::process::exit(0);
          }
          "show_widget" => {
            println!("📱 Show widget menu clicked");
            native_widget::create_native_timer_widget();
          }
          _ => {}
        }
      }
      _ => {}
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
