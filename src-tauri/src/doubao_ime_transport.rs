use std::{io::Read, time::Duration};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use openssl::{
    bn::BigNumContext,
    derive::Deriver,
    ec::{EcGroup, EcKey, EcPoint, PointConversionForm},
    hash::MessageDigest,
    nid::Nid,
    pkey::PKey,
    rand::rand_bytes,
    sign::{Signer, Verifier},
    symm::{Cipher, Crypter, Mode},
    x509::X509,
};
use reqwest::{Client, Response, redirect::Policy};
use serde_json::{Value, json};

const LIMIT: usize = 2 * 1024 * 1024;
const ERROR: &str = "豆包文本服务请求失败；原文已保留";

fn checked<T, E>(result: Result<T, E>) -> Result<T, String> {
    result.map_err(|_| ERROR.to_owned())
}

async fn body(mut response: Response) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = checked(response.chunk().await)? {
        if bytes.len().saturating_add(chunk.len()) > LIMIT {
            return Err(ERROR.to_owned());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn decode(value: &str) -> Result<Vec<u8>, String> {
    checked(STANDARD.decode(value))
}
fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str, String> {
    value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| ERROR.to_owned())
}
fn hmac(key: &[u8], input: &[u8]) -> Result<Vec<u8>, String> {
    let key = checked(PKey::hmac(key))?;
    let mut signer = checked(Signer::new(MessageDigest::sha256(), &key))?;
    checked(signer.update(input))?;
    checked(signer.sign_to_vec())
}
fn crypt(input: &[u8], key: &[u8], nonce: &[u8]) -> Result<Vec<u8>, String> {
    if nonce.len() != 12 || key.len() != 32 {
        return Err(ERROR.to_owned());
    }
    let mut iv = [0u8; 16];
    iv[4..].copy_from_slice(nonce);
    let mut cipher = checked(Crypter::new(
        Cipher::chacha20(),
        Mode::Encrypt,
        key,
        Some(&iv),
    ))?;
    let mut output = vec![0; input.len() + Cipher::chacha20().block_size()];
    let count = checked(cipher.update(input, &mut output))?;
    let end = checked(cipher.finalize(&mut output[count..]))?;
    output.truncate(count + end);
    Ok(output)
}
fn decompress(input: &[u8], encoding: &str) -> Result<Vec<u8>, String> {
    let reader: Box<dyn Read + '_> = match encoding {
        "" | "identity" => return Ok(input.to_vec()),
        "gzip" => Box::new(flate2::read::GzDecoder::new(input)),
        "deflate" => Box::new(flate2::read::ZlibDecoder::new(input)),
        _ => return Err(ERROR.to_owned()),
    };
    let mut out = Vec::new();
    checked(reader.take((LIMIT + 1) as u64).read_to_end(&mut out))?;
    if out.len() > LIMIT {
        return Err(ERROR.to_owned());
    }
    Ok(out)
}

/// Uses only this application's registered device and explicitly selected account.
/// No remote context, dictionary, clipboard or login state is mutated here.
pub async fn organize(token: &str, did: &str, iid: &str, text: &str) -> Result<String, String> {
    request_text(token, did, iid, text, false).await
}

pub async fn translate(token: &str, did: &str, iid: &str, text: &str) -> Result<String, String> {
    request_text(token, did, iid, text, true).await
}

async fn request_text(
    token: &str,
    did: &str,
    iid: &str,
    text: &str,
    translate: bool,
) -> Result<String, String> {
    if token.is_empty()
        || token.len() > 16384
        || text.trim().is_empty()
        || text.len() > 32000
        || ![did, iid]
            .iter()
            .all(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(ERROR.to_owned());
    }
    let client = checked(
        Client::builder()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(60))
            .build(),
    )?;
    let group = checked(EcGroup::from_curve_name(Nid::X9_62_PRIME256V1))?;
    let ec = checked(EcKey::generate(&group))?;
    let mut ctx = checked(BigNumContext::new())?;
    let public = checked(ec.public_key().to_bytes(
        &group,
        PointConversionForm::UNCOMPRESSED,
        &mut ctx,
    ))?;
    let private = checked(PKey::from_ec_key(ec))?;
    let mut random = [0; 32];
    checked(rand_bytes(&mut random))?;
    let request = checked(serde_json::to_vec(
        &json!({"version":2,"random":STANDARD.encode(random),
        "app_id":"401734","did":did,"key_shares":[{"curve":"secp256r1","pubkey":STANDARD.encode(public)}],"cipher_suites":[4097]}),
    ))?;
    let mut signer = checked(Signer::new(MessageDigest::sha256(), &private))?;
    checked(signer.update(&request))?;
    let response = checked(
        client
            .post("https://keyhub.zijieapi.com/handshake")
            .header("Content-Type", "application/json")
            .header("Accept-Encoding", "identity")
            .header(
                "x-tt-s-sign",
                STANDARD.encode(checked(signer.sign_to_vec())?),
            )
            .body(request)
            .send()
            .await,
    )?;
    if !response.status().is_success() {
        return Err(ERROR.to_owned());
    }
    let headers = response.headers().clone();
    let raw = body(response).await?;
    let result: Value = checked(serde_json::from_slice(&raw))?;
    if result["version"] != 2
        || result["cipher_suite"] != 4097
        || result["key_share"]["curve"] != "secp256r1"
        || result["ticket_exp"].as_u64().unwrap_or(0) < 60
    {
        return Err(ERROR.to_owned());
    }
    let certificate = checked(X509::from_pem(field(&result, "cert")?.as_bytes()))?;
    let certificate_key = checked(certificate.public_key())?;
    let signature = headers
        .get("x-tt-s-cert-sign")
        .and_then(|v| v.to_str().ok())
        .ok_or(ERROR)?;
    let mut verifier = checked(Verifier::new(MessageDigest::sha256(), &certificate_key))?;
    checked(verifier.update(&raw))?;
    if !checked(verifier.verify(&decode(signature)?))? {
        return Err(ERROR.to_owned());
    }
    let point = checked(EcPoint::from_bytes(
        &group,
        &decode(field(&result["key_share"], "pubkey")?)?,
        &mut ctx,
    ))?;
    let peer = checked(PKey::from_ec_key(checked(EcKey::from_public_key(
        &group, &point,
    ))?))?;
    let mut verifier = checked(Verifier::new(MessageDigest::sha256(), &peer))?;
    checked(verifier.update(signature.as_bytes()))?;
    let peer_signature = headers
        .get("x-tt-s-sign")
        .and_then(|v| v.to_str().ok())
        .ok_or(ERROR)?;
    if !checked(verifier.verify(&decode(peer_signature)?))? {
        return Err(ERROR.to_owned());
    }
    let mut deriver = checked(Deriver::new(&private))?;
    checked(deriver.set_peer(&peer))?;
    let secret = checked(deriver.derive_to_vec())?;
    let mut salt = random.to_vec();
    let server_random = decode(field(&result, "random")?)?;
    if server_random.len() != 32 {
        return Err(ERROR.to_owned());
    }
    salt.extend(server_random);
    let prk = hmac(&salt, &secret)?;
    let key = hmac(&prk, b"4e30514609050cd3\x01")?;
    let mut nonce = [0; 12];
    checked(rand_bytes(&mut nonce))?;
    let (endpoint, payload) = if translate {
        (
            "https://ime.doubao.com/api/v1/translate",
            json!({"source_language":185,
            "target_language":38,"text_list":[text]}),
        )
    } else {
        (
            "https://ime.doubao.com/api/v2/ai/text_organization",
            json!({"scene":6,"query":text,
            "space_at_cn_en_nb":1,"space_at_newline":1,"stream":true}),
        )
    };
    let payload = checked(serde_json::to_vec(&payload))?;
    let mut auth = checked(reqwest::header::HeaderValue::from_str(token))?;
    auth.set_sensitive(true);
    let mut ticket = checked(reqwest::header::HeaderValue::from_str(field(
        &result, "ticket",
    )?))?;
    ticket.set_sensitive(true);
    let response = checked(
        client
            .post(endpoint)
            .query(&[
                ("aid", "401734"),
                ("device_platform", "android"),
                ("device_id", did),
                ("iid", iid),
                ("version_code", "100406010"),
                ("version_name", "1.4.6"),
                ("use-olympus-account", "1"),
            ])
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .header("Accept-Encoding", "identity")
            .header("x-tt-token", auth)
            .header("sdk-version", "2")
            .header("x-tt-e-t", ticket)
            .header("x-tt-e-p", STANDARD.encode(nonce))
            .header("x-tt-e-b", "1")
            .header("x-metasec-bp-body-compress", "1")
            .body(crypt(&payload, &key, &nonce)?)
            .send()
            .await,
    )?;
    if !response.status().is_success() {
        return Err(ERROR.to_owned());
    }
    let headers = response.headers().clone();
    let mut raw = body(response).await?;
    let encrypted = headers.contains_key("x-tt-e-b");
    let encoding = headers
        .get("content-encoding")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !encrypted || headers.contains_key("x-tt-r-d") {
        raw = decompress(&raw, encoding)?;
    }
    if encrypted {
        let nonce = headers
            .get("x-tt-e-p")
            .and_then(|v| v.to_str().ok())
            .ok_or(ERROR)?;
        raw = crypt(&raw, &key, &decode(nonce)?)?;
        if !headers.contains_key("x-tt-r-d") {
            raw = decompress(&raw, encoding)?;
        }
    }
    if translate {
        let value: Value = checked(serde_json::from_slice(&raw))?;
        if value["code"] != 0 {
            return Err(ERROR.to_owned());
        }
        let result = value
            .pointer("/data/translation_list/0/translation")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or(ERROR)?;
        Ok(result.to_owned())
    } else {
        parse_result(checked(std::str::from_utf8(&raw))?)
    }
}

fn parse_result(text: &str) -> Result<String, String> {
    let mut event = "";
    let mut data = String::new();
    let mut final_text = None;
    let mut done = false;
    for line in text.lines().chain(std::iter::once("")) {
        if let Some(value) = line.strip_prefix("event:") {
            event = value.trim();
        } else if let Some(value) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value.trim_start());
        } else if line.is_empty() {
            match event {
                "scene.error" => return Err(ERROR.to_owned()),
                "scene.completed" => {
                    let value: Value = checked(serde_json::from_str(&data))?;
                    let content = field(&value, "content")?;
                    if content.trim().is_empty() || final_text.is_some() {
                        return Err(ERROR.to_owned());
                    }
                    final_text = Some(content.to_owned());
                }
                "done" if data == "[DONE]" => done = true,
                _ => {}
            }
            event = "";
            data.clear();
        }
    }
    if !done {
        return Err(ERROR.to_owned());
    }
    final_text.ok_or_else(|| ERROR.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_or_failed_stream_never_replaces_original() {
        assert!(
            parse_result(
                "event:scene.delta\ndata:{\"content\":\"部分\"}\n\nevent:done\ndata:[DONE]\n\n"
            )
            .is_err()
        );
        let complete =
            "event:scene.completed\ndata:{\"content\":\"完整结果\"}\n\nevent:done\ndata:[DONE]\n\n";
        assert_eq!(parse_result(complete).unwrap(), "完整结果");
        assert!(parse_result(&format!("{complete}event:scene.error\ndata:{{}}\n\n")).is_err());
        assert!(parse_result("event:scene.completed\ndata:{\"content\":\"未结束\"}\n\n").is_err());
    }
}
