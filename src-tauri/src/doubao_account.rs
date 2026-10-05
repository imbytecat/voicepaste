use std::{sync::Arc, time::Duration};

use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::Mutex;

use crate::{asr::ServiceIssue, settings};

const SECRET: &str = "doubao-ime-account";
const LOGIN_WINDOW: &str = "doubao-ime-login";
const QR_HOST: &str = "https://accounts.doubao.com";
const QR_NEXT: &str = "https://www.doubao.com";
const MAX_RESPONSE: usize = 384 * 1024;
// Public desktop IME application ID, verified by get_qrcode's web_name response.
const DESKTOP_AID: &str = "685343";

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AccountState {
    Guest,
    SigningIn,
    SignedIn,
    Expired,
    Unavailable,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub state: AccountState,
    pub nickname: Option<String>,
    pub message: Option<String>,
    pub revision: u64,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Session {
    version: u8,
    token: Option<String>,
    nickname: Option<String>,
    expired: bool,
    subject: Option<String>,
    owner_id: Option<String>,
}

struct Inner {
    loaded: bool,
    session: Option<Session>,
    // Outer None: no login in progress. Inner None: previous identity was guest.
    previous: Option<Option<Session>>,
    attempt: u64,
    status: AccountStatus,
    poll_abort: Option<tokio::task::AbortHandle>,
}

pub struct AccountManager {
    inner: Mutex<Inner>,
}

impl Default for AccountManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AccountManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                loaded: false,
                session: None,
                previous: None,
                attempt: 0,
                status: AccountStatus {
                    state: AccountState::Guest,
                    nickname: None,
                    message: None,
                    revision: 0,
                },
                poll_abort: None,
            }),
        }
    }

    pub async fn status(&self, app: &AppHandle) -> AccountStatus {
        let mut inner = self.inner.lock().await;
        load(&mut inner, app).await;
        inner.status.clone()
    }

    pub async fn login(self: &Arc<Self>, app: &AppHandle) -> Result<AccountStatus, String> {
        let mut inner = self.inner.lock().await;
        load(&mut inner, app).await;
        if !inner.loaded {
            return Ok(inner.status.clone());
        }
        if matches!(
            inner.status.state,
            AccountState::SigningIn | AccountState::SignedIn
        ) {
            if let Some(window) = app.get_webview_window(LOGIN_WINDOW) {
                let _ = window.set_focus();
            }
            return Ok(inner.status.clone());
        }
        // Commit account intent before opening a QR. A crash must not turn it into guest mode.
        let previous = inner.session.clone();
        let pending = Session {
            version: 2,
            token: None,
            nickname: previous
                .as_ref()
                .and_then(|session| session.nickname.clone()),
            expired: true,
            subject: previous
                .as_ref()
                .and_then(|session| session.subject.clone()),
            owner_id: previous
                .as_ref()
                .and_then(|session| session.owner_id.clone()),
        };
        if store(Some(pending.clone())).await.is_err() {
            update(
                &mut inner,
                app,
                AccountState::Unavailable,
                Some("无法保存账号选择，请解锁系统凭据库后重试；不会改用游客识别"),
            );
            return Ok(inner.status.clone());
        }
        inner.attempt += 1;
        let attempt = inner.attempt;
        inner.previous = Some(previous);
        inner.session = Some(pending);
        update(
            &mut inner,
            app,
            AccountState::SigningIn,
            Some("请用豆包或豆包输入法 App 扫码，并在手机上确认登录豆包输入法 PC 端"),
        );
        let result = async {
            clear_window(app)?;
            let client = client(true).map_err(|_| "无法初始化豆包账号连接")?;
            let response = passport_get(&client, "/passport/web/get_qrcode/")
                .query(&[("biz_aid", DESKTOP_AID)])
                .send()
                .await
                .map_err(|_| "无法连接豆包账号服务，请检查网络后重新登录")?;
            let (_, body) = response_json(response).await?;
            let qr = parse_qr(&body)?;
            let url = app
                .get_webview_window("settings")
                .ok_or("找不到设置窗口")?
                .url()
                .map_err(|_| "无法读取设置窗口地址")?
                .join("/doubao-login.html")
                .map_err(|_| "无法创建独立登录页面")?;
            let document_url = url.clone();
            let image = serde_json::to_string(&format!("data:image/png;base64,{}", qr.image))
                .map_err(|_| "无法显示官方登录二维码")?;
            let render_qr = format!("document.getElementById('doubao-login-qr').src={image};");
            let allowed = url.clone();
            let window =
                WebviewWindowBuilder::new(app, LOGIN_WINDOW, WebviewUrl::External(url.clone()))
                    .title("登录豆包输入法 — VoicePaste")
                    .inner_size(420.0, 560.0)
                    .resizable(false)
                    .incognito(true)
                    .devtools(false)
                    .disable_drag_drop_handler()
                    .on_page_load(move |window, payload| {
                        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                            && payload.url() == &document_url
                        {
                            let _ = window.eval(&render_qr);
                        }
                    })
                    .on_navigation(move |target| target == &allowed)
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .build()
                    .map_err(|_| "无法打开独立登录窗口")?;
            let manager = self.clone();
            let handle = app.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let manager = manager.clone();
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = manager.cancel_attempt(&handle, Some(attempt)).await;
                    });
                }
            });
            Ok::<_, &str>((client, qr.token, url))
        }
        .await;
        match result {
            Ok((client, qr_token, url)) => {
                let manager = self.clone();
                let handle = app.clone();
                let task = tokio::spawn(async move {
                    manager
                        .poll_login(handle, attempt, client, qr_token, url)
                        .await;
                });
                inner.poll_abort = Some(task.abort_handle());
            }
            Err(message) => {
                inner.previous = None;
                update(&mut inner, app, AccountState::Unavailable, Some(message));
            }
        }
        Ok(inner.status.clone())
    }

    pub async fn cancel(&self, app: &AppHandle) -> Result<AccountStatus, String> {
        self.cancel_attempt(app, None).await
    }

    /// Leaving this provider must not load credentials or initiate account requests.
    pub async fn deactivate(&self, app: &AppHandle) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        cancel_pending(&mut inner, app).await
    }

    async fn cancel_attempt(
        &self,
        app: &AppHandle,
        attempt: Option<u64>,
    ) -> Result<AccountStatus, String> {
        let mut inner = self.inner.lock().await;
        load(&mut inner, app).await;
        if attempt.is_some_and(|attempt| inner.attempt != attempt) {
            return Ok(inner.status.clone());
        }
        cancel_pending(&mut inner, app).await?;
        Ok(inner.status.clone())
    }

    pub async fn logout(&self, app: &AppHandle) -> Result<AccountStatus, String> {
        let mut inner = self.inner.lock().await;
        load(&mut inner, app).await;
        inner.attempt += 1;
        if let Some(task) = inner.poll_abort.take() {
            task.abort();
        }
        inner.previous = None;
        if let Err(message) = clear_window(app) {
            update(&mut inner, app, AccountState::Unavailable, Some(message));
        } else if store(None).await.is_err() {
            update(
                &mut inner,
                app,
                AccountState::Unavailable,
                Some("无法删除系统凭据库中的豆包会话；账号选择已保留，请解锁凭据库后重试"),
            );
        } else {
            inner.session = None;
            update(
                &mut inner,
                app,
                AccountState::Guest,
                Some("已清除本机豆包会话；如需撤销服务端设备授权，请在豆包 App 的设备管理中操作"),
            );
        }
        Ok(inner.status.clone())
    }

    pub async fn resolve_token(&self, app: &AppHandle) -> Result<Option<String>, ServiceIssue> {
        let mut inner = self.inner.lock().await;
        load(&mut inner, app).await;
        if inner.status.state == AccountState::SigningIn {
            return Err(ServiceIssue::login_required("请先完成或取消豆包账号登录"));
        }
        if inner.status.state == AccountState::Guest {
            return Ok(None);
        }
        let Some(session) = inner.session.as_ref() else {
            return Err(ServiceIssue::credential_storage(
                "无法读取已选择的豆包账号；请重试登录或明确退出到游客模式",
            ));
        };
        let Some(token) = session.token.as_deref().filter(|_| !session.expired) else {
            return Err(ServiceIssue::login_required(
                "豆包账号会话已过期，请重新登录或明确退出到游客模式",
            ));
        };
        match validate_token(token).await {
            Ok(account) => {
                if session
                    .subject
                    .as_deref()
                    .is_some_and(|subject| subject != account.subject)
                {
                    let message = "豆包返回的账号与已选择身份不一致，请重新登录；不会切换账号";
                    update(&mut inner, app, AccountState::Unavailable, Some(message));
                    return Err(ServiceIssue::login_required(message));
                }
                let token = account.token.clone();
                let session = verified_session(account, Some(session));
                if inner.session.as_ref() != Some(&session)
                    && store(Some(session.clone())).await.is_err()
                {
                    update(
                        &mut inner,
                        app,
                        AccountState::Unavailable,
                        Some("账号验证成功，但无法安全保存会话；请解锁系统凭据库后重试"),
                    );
                    return Err(ServiceIssue::credential_storage(
                        "无法安全保存豆包会话，不会改用游客识别",
                    ));
                }
                inner.session = Some(session);
                update(&mut inner, app, AccountState::SignedIn, None);
                Ok(Some(token))
            }
            Err(ValidationError::Expired) => {
                expire(&mut inner, app).await;
                Err(ServiceIssue::login_required(
                    "豆包账号会话已过期，请重新登录或明确退出到游客模式",
                ))
            }
            Err(ValidationError::Unavailable(message)) => {
                update(&mut inner, app, AccountState::Unavailable, Some(message));
                Err(ServiceIssue::network(message))
            }
        }
    }

    pub async fn mark_expired(&self, app: &AppHandle) -> AccountStatus {
        let mut inner = self.inner.lock().await;
        load(&mut inner, app).await;
        if inner.session.is_some() {
            expire(&mut inner, app).await;
        }
        inner.status.clone()
    }

    async fn poll_login(
        self: Arc<Self>,
        app: AppHandle,
        attempt: u64,
        client: Client,
        qr_token: String,
        url: Url,
    ) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(300);
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            {
                let inner = self.inner.lock().await;
                if inner.attempt != attempt || inner.previous.is_none() {
                    return;
                }
            }
            let window_matches = app
                .get_webview_window(LOGIN_WINDOW)
                .and_then(|window| window.url().ok())
                .is_some_and(|current| current == url);
            if !window_matches {
                let manager = Arc::clone(&self);
                let handle = app.clone();
                tokio::spawn(async move {
                    let _ = manager.cancel_attempt(&handle, Some(attempt)).await;
                });
                return;
            }
            let result = if tokio::time::Instant::now() >= deadline {
                Err("二维码已过期，请重新登录")
            } else {
                poll_qr(&client, &qr_token).await
            };
            let result = match result {
                Ok(None) => continue,
                Ok(Some(token)) => validate_token(&token).await.map_err(|error| match error {
                    ValidationError::Expired => "扫码会话未通过豆包输入法服务验证，请重新登录",
                    ValidationError::Unavailable(message) => message,
                }),
                Err(message) => Err(message),
            };
            let mut inner = self.inner.lock().await;
            if inner.attempt != attempt || inner.previous.is_none() {
                return;
            }
            let previous = inner.previous.take().flatten();
            inner.poll_abort = None;
            match result {
                Ok(account) => {
                    let session = verified_session(account, previous.as_ref());
                    if store(Some(session.clone())).await.is_err() {
                        update(
                            &mut inner,
                            &app,
                            AccountState::Unavailable,
                            Some("扫码验证成功，但无法安全保存会话；请解锁系统凭据库后重新登录"),
                        );
                    } else {
                        inner.session = Some(session);
                        update(&mut inner, &app, AccountState::SignedIn, None);
                    }
                }
                Err(message) => update(&mut inner, &app, AccountState::Unavailable, Some(message)),
            }
            if let Err(message) = clear_window(&app) {
                update(&mut inner, &app, AccountState::Unavailable, Some(message));
            }
            return;
        }
    }
}

async fn cancel_pending(inner: &mut Inner, app: &AppHandle) -> Result<(), String> {
    inner.attempt += 1;
    if let Some(task) = inner.poll_abort.take() {
        task.abort();
    }
    if let Err(message) = clear_window(app) {
        update(inner, app, AccountState::Unavailable, Some(message));
        return Err(message.to_owned());
    }
    if let Some(previous) = inner.previous.as_ref() {
        if store(previous.clone()).await.is_err() {
            let message = "登录已取消，但无法恢复系统凭据库中的账号选择；请重试取消或退出";
            update(inner, app, AccountState::Unavailable, Some(message));
            return Err(message.to_owned());
        }
        inner.session = inner.previous.take().flatten();
        restore_status(inner, app);
    }
    Ok(())
}

struct VerifiedAccount {
    subject: String,
    nickname: String,
    token: String,
}

fn verified_session(account: VerifiedAccount, previous: Option<&Session>) -> Session {
    let owner_id = previous
        .filter(|session| session.subject.as_deref() == Some(&account.subject))
        .and_then(|session| session.owner_id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    Session {
        version: 2,
        token: Some(account.token),
        nickname: Some(account.nickname),
        expired: false,
        subject: Some(account.subject),
        owner_id: Some(owner_id),
    }
}

fn valid_session(session: &Session) -> bool {
    if !session.token.as_deref().is_none_or(valid_token) {
        return false;
    }
    match (
        session.version,
        session.subject.as_deref(),
        session.owner_id.as_deref(),
    ) {
        (2, Some(subject), Some(owner)) => {
            subject.parse::<u64>().is_ok_and(|id| id > 0) && uuid::Uuid::parse_str(owner).is_ok()
        }
        (2, None, None) => session.expired && session.token.is_none(),
        _ => false,
    }
}

async fn load(inner: &mut Inner, app: &AppHandle) {
    if inner.loaded {
        return;
    }
    inner.loaded = true;
    let secret = tokio::task::spawn_blocking(|| settings::read_secret(SECRET)).await;
    match secret {
        Ok(Ok(None)) => {
            inner.session = None;
            restore_status(inner, app);
        }
        Ok(Ok(Some(value))) => match serde_json::from_str::<Session>(&value) {
            Ok(session) if valid_session(&session) => {
                inner.session = Some(session);
                restore_status(inner, app);
            }
            _ => {
                inner.loaded = false;
                inner.session = None;
                update(
                    inner,
                    app,
                    AccountState::Unavailable,
                    Some("已保存的豆包会话格式不受支持；原凭据未修改，请明确退出后重新登录"),
                );
            }
        },
        _ => {
            inner.loaded = false;
            update(
                inner,
                app,
                AccountState::Unavailable,
                Some("无法访问系统凭据库；不会把已选择的账号当作游客"),
            );
        }
    }
}

async fn store(session: Option<Session>) -> Result<(), ()> {
    let value = session
        .map(|session| serde_json::to_string(&session))
        .transpose()
        .map_err(|_| ())?;
    tokio::task::spawn_blocking(move || settings::write_secret(SECRET, value.as_deref()))
        .await
        .map_err(|_| ())?
        .map_err(|_| ())
}

fn restore_status(inner: &mut Inner, app: &AppHandle) {
    let state = match &inner.session {
        None => AccountState::Guest,
        Some(session) if session.expired || session.token.is_none() => AccountState::Expired,
        Some(_) => AccountState::SignedIn,
    };
    update(
        inner,
        app,
        state,
        if state == AccountState::Expired {
            Some("请重新登录豆包账号，或明确退出到游客模式")
        } else {
            None
        },
    );
}

async fn expire(inner: &mut Inner, app: &AppHandle) {
    if let Some(session) = &mut inner.session {
        session.expired = true;
        session.token = None;
    }
    if store(inner.session.clone()).await.is_err() {
        update(
            inner,
            app,
            AccountState::Unavailable,
            Some("账号已失效，且无法更新系统凭据库；请重新登录或重试退出"),
        );
    } else {
        update(
            inner,
            app,
            AccountState::Expired,
            Some("豆包账号会话已过期，请重新登录或退出到游客模式"),
        );
    }
}

fn update(inner: &mut Inner, app: &AppHandle, state: AccountState, message: Option<&str>) {
    let nickname = inner
        .session
        .as_ref()
        .and_then(|session| session.nickname.clone());
    if inner.status.state == state
        && inner.status.nickname == nickname
        && inner.status.message.as_deref() == message
    {
        return;
    }
    inner.status = AccountStatus {
        state,
        nickname,
        message: message.map(str::to_owned),
        revision: inner.status.revision + 1,
    };
    let _ = app.emit_to("settings", "doubao-account-changed", &inner.status);
}

fn clear_window(app: &AppHandle) -> Result<(), &'static str> {
    if let Some(window) = app.get_webview_window(LOGIN_WINDOW) {
        window
            .clear_all_browsing_data()
            .map_err(|_| "无法清理独立登录窗口，请关闭窗口后重试退出")?;
        window
            .destroy()
            .map_err(|_| "无法关闭独立登录窗口，请重试退出")?;
    }
    Ok(())
}

fn client(cookies: bool) -> Result<Client, reqwest::Error> {
    Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(12))
        .cookie_store(cookies)
        .user_agent("VoicePaste Doubao-IME account integration")
        .build()
}

fn passport_get(client: &Client, path: &str) -> reqwest::RequestBuilder {
    client
        .get(format!("{QR_HOST}{path}"))
        .header("sdk-version", "2")
        .header("passport-sdk-version", "605195")
        .query(&[
            ("aid", DESKTOP_AID),
            ("device_platform", "mac"),
            ("is_from_ttaccountsdk", "1"),
            ("next", QR_NEXT),
        ])
}

async fn response_json(mut response: Response) -> Result<(Option<String>, Value), &'static str> {
    if !response.status().is_success() {
        return Err("豆包账号服务暂时不可用，请稍后重试");
    }
    let token = response
        .headers()
        .get("x-tt-token")
        .and_then(|header| header.to_str().ok())
        .filter(|token| valid_token(token))
        .map(str::to_owned);
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE as u64)
    {
        return Err("豆包账号响应过大，已停止登录");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取豆包账号响应失败，请重试")?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE {
            return Err("豆包账号响应过大，已停止登录");
        }
        bytes.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice(&bytes).map_err(|_| "豆包账号响应格式无法识别，请重试")?;
    Ok((token, value))
}

struct QrCode {
    token: String,
    image: String,
}

fn parse_qr(body: &Value) -> Result<QrCode, &'static str> {
    if body["message"] != "success" || body["data"]["error_code"] != 0 {
        return Err("豆包输入法扫码登录暂时不可用，请稍后重试");
    }
    let data = &body["data"];
    let token = data["token"]
        .as_str()
        .filter(|token| valid_token(token))
        .ok_or("登录二维码缺少有效会话标识")?;
    let image = data["qrcode"]
        .as_str()
        .filter(|image| {
            image.starts_with("iVBORw0KGgo")
                && image.len() < MAX_RESPONSE
                && image
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"+/=".contains(&byte))
        })
        .ok_or("登录二维码格式不受支持")?;
    let target = data["qrcode_index_url"]
        .as_str()
        .and_then(|value| Url::parse(value).ok())
        .ok_or("登录二维码地址无效")?;
    if !valid_qr_target(&target, token) {
        return Err("登录二维码不属于豆包输入法，已拒绝打开");
    }
    Ok(QrCode {
        token: token.to_owned(),
        image: image.to_owned(),
    })
}

fn valid_qr_target(url: &Url, token: &str) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("www.doubao.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.path() == "/flow-account/scan-login"
        && [
            ("token", token),
            ("biz_aid", DESKTOP_AID),
            ("qr_source_aid", DESKTOP_AID),
            ("device_platform", "mac"),
            ("next_url", "https://www.doubao.com/flow-account/scan-login"),
        ]
        .into_iter()
        .all(|(name, expected)| {
            let mut values = url.query_pairs().filter(|(key, _)| key == name);
            values.next().is_some_and(|(_, value)| value == expected) && values.next().is_none()
        })
}

async fn poll_qr(client: &Client, token: &str) -> Result<Option<String>, &'static str> {
    let response = passport_get(client, "/passport/web/check_qrconnect/")
        .query(&[("token", token)])
        .send()
        .await
        .map_err(|_| "扫码登录连接中断，请检查网络后重新登录")?;
    let (account_token, body) = response_json(response).await?;
    if body["message"] != "success" || body["data"]["error_code"] != 0 {
        return Err("豆包未接受此次扫码登录，请重新登录");
    }
    match body["data"]["status"].as_str() {
        Some("new" | "scanned") => Ok(None),
        Some("confirmed") => account_token
            .map(Some)
            .ok_or("官方扫码未返回输入法会话令牌，不能将网页 Cookie 当作登录成功"),
        Some("expired") => Err("二维码已过期，请重新登录"),
        Some("refused") => Err("手机端已拒绝登录，请重新登录"),
        _ => Err("豆包扫码状态无法识别，已停止登录"),
    }
}

enum ValidationError {
    Expired,
    Unavailable(&'static str),
}

async fn validate_token(token: &str) -> Result<VerifiedAccount, ValidationError> {
    if !valid_token(token) {
        return Err(ValidationError::Expired);
    }
    // No QR cookie jar here: success must authenticate this token, not a browser/chat cookie.
    let response = client(false)
        .map_err(|_| ValidationError::Unavailable("无法初始化豆包账号连接"))?
        .get("https://ime.doubao.com/passport/account/info/v2/")
        .header("x-tt-token", token)
        .header("sdk-version", "2")
        .header("passport-sdk-version", "605195")
        .query(&[
            ("aid", "401734"),
            ("device_platform", "android"),
            ("is_from_ttaccountsdk", "1"),
        ])
        .send()
        .await
        .map_err(|_| {
            ValidationError::Unavailable("无法验证豆包账号，请检查网络；会话未删除，也不会改用游客")
        })?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(ValidationError::Expired);
    }
    let (rotated, body) = response_json(response)
        .await
        .map_err(ValidationError::Unavailable)?;
    if body["data"]["error_code"].as_i64() == Some(13) {
        return Err(ValidationError::Expired);
    }
    if body["message"] != "success"
        || body["data"]["error_code"]
            .as_i64()
            .is_some_and(|code| code != 0)
    {
        return Err(ValidationError::Unavailable(
            "豆包输入法服务未接受此会话，请重新登录；不会改用游客",
        ));
    }
    let data = &body["data"];
    let subject = ["user_id", "user_id_str"]
        .iter()
        .find_map(|field| {
            data[field]
                .as_u64()
                .or_else(|| {
                    data[field]
                        .as_str()
                        .and_then(|value| value.parse::<u64>().ok())
                })
                .filter(|id| *id > 0)
        })
        .ok_or(ValidationError::Unavailable(
            "豆包输入法未返回有效账号，无法确认登录",
        ))?;
    let nickname = ["screen_name", "nickname", "name"]
        .iter()
        .find_map(|field| data[field].as_str())
        .unwrap_or("豆包账号")
        .chars()
        .filter(|character| !character.is_control())
        .take(80)
        .collect();
    Ok(VerifiedAccount {
        subject: subject.to_string(),
        nickname,
        token: rotated.unwrap_or_else(|| token.to_owned()),
    })
}

fn valid_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 16 * 1024
        && token.bytes().all(|byte| byte.is_ascii_graphic())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_identity_cannot_change_origin_application_or_attempt() {
        let target = "https://www.doubao.com/flow-account/scan-login?biz_aid=685343&qr_source_aid=685343&device_platform=mac&next_url=https%3A%2F%2Fwww.doubao.com%2Fflow-account%2Fscan-login&token=attempt-one";
        assert!(valid_qr_target(&Url::parse(target).unwrap(), "attempt-one"));
        assert!(!valid_qr_target(
            &Url::parse(target).unwrap(),
            "attempt-two"
        ));
        for changed in [
            target.replace("https://", "http://"),
            target.replace("www.doubao.com", "www.doubao.com.attacker.invalid"),
            target.replace("685343", "497858"),
            format!("{target}&token=attempt-two"),
            format!("{target}&biz_aid=497858"),
            target.replace("https://", "https://user@"),
        ] {
            assert!(!valid_qr_target(
                &Url::parse(&changed).unwrap(),
                "attempt-one"
            ));
        }
        assert!(!valid_token("value\r\nx-injected: yes"));
    }

    #[test]
    fn account_owner_survives_token_rotation_but_never_an_account_change() {
        let first = verified_session(
            VerifiedAccount {
                subject: "42".to_owned(),
                nickname: "name".to_owned(),
                token: "token-one".to_owned(),
            },
            None,
        );
        let refreshed = verified_session(
            VerifiedAccount {
                subject: "42".to_owned(),
                nickname: "renamed".to_owned(),
                token: "token-two".to_owned(),
            },
            Some(&first),
        );
        assert_eq!(refreshed.owner_id, first.owner_id);
        assert_eq!(refreshed.token.as_deref(), Some("token-two"));
        let switched = verified_session(
            VerifiedAccount {
                subject: "43".to_owned(),
                nickname: "renamed".to_owned(),
                token: "token-three".to_owned(),
            },
            Some(&refreshed),
        );
        assert_ne!(switched.owner_id, first.owner_id);
        assert_eq!(switched.subject.as_deref(), Some("43"));
        assert!(valid_session(&switched));
        let mut invalid = switched;
        invalid.subject = None;
        assert!(!valid_session(&invalid));
    }
}
