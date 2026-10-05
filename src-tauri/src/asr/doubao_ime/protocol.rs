use std::{borrow::Cow, collections::BTreeMap};

use prost::Message;
use serde::Deserialize;

use super::super::ServiceIssue;

pub(super) const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_RESULT_BYTES: usize = 512 * 1024;
const MAX_TEXT_BYTES: usize = 256 * 1024;
const MAX_SEGMENTS: u32 = 4096;

// Independently expressed wire facts verified against the observed v2 traffic.
// No protoc or third-party generated source is needed for this small schema.
#[derive(Clone, PartialEq, Message)]
pub(super) struct Request {
    #[prost(string, tag = "2")]
    pub app_key: String,
    #[prost(string, tag = "3")]
    pub service_name: String,
    #[prost(string, tag = "5")]
    pub method_name: String,
    #[prost(string, tag = "6")]
    pub payload: String,
    #[prost(bytes = "vec", tag = "7")]
    pub audio_data: Vec<u8>,
    #[prost(string, tag = "8")]
    pub request_id: String,
    #[prost(uint64, tag = "9")]
    pub sequence_id: u64,
}

impl Request {
    pub fn control(method: &str, request_id: &str, app_key: &str) -> Self {
        Self {
            service_name: "ASR".to_owned(),
            method_name: method.to_owned(),
            request_id: request_id.to_owned(),
            app_key: app_key.to_owned(),
            ..Self::default()
        }
    }
}

#[derive(Clone, PartialEq, Message)]
pub(super) struct Response {
    #[prost(string, tag = "1")]
    pub request_id: String,
    #[prost(string, tag = "3")]
    pub service_name: String,
    #[prost(string, tag = "4")]
    pub event: String,
    #[prost(int32, tag = "5")]
    pub status: i32,
    #[prost(string, tag = "7")]
    pub result_json: String,
}

impl Response {
    pub fn parse(data: &[u8], request_id: &str, has_account: bool) -> Result<Self, ServiceIssue> {
        if data.len() > MAX_MESSAGE_BYTES {
            return Err(ServiceIssue::unknown("豆包输入法响应超过大小限制"));
        }
        let response = Self::decode(data)
            .map_err(|_| ServiceIssue::unknown("豆包输入法返回了无效的 protobuf 消息"))?;
        if (!response.request_id.is_empty() && response.request_id != request_id)
            || (!response.service_name.is_empty() && response.service_name != "ASR")
        {
            return Err(ServiceIssue::unknown("豆包输入法响应不属于当前语音任务"));
        }
        if response.status != 20_000_000 {
            // Only an explicit authentication failure expires a chosen account.
            // Unknown private status codes are not guessed from response text.
            if response.status == 401 && has_account {
                return Err(ServiceIssue::login_required(
                    "语音服务拒绝了已选择的账号凭据",
                ));
            }
            return Err(ServiceIssue::new(
                if response.status == 429 {
                    "rateLimited"
                } else {
                    "server"
                },
                "豆包输入法语音请求失败",
                format!("服务状态码 {}", response.status),
            ));
        }
        if matches!(response.event.as_str(), "TaskFailed" | "SessionFailed") {
            return Err(ServiceIssue::new(
                "server",
                "豆包输入法语音任务失败",
                "服务端终止了当前任务",
            ));
        }
        if response.result_json.len() > MAX_RESULT_BYTES {
            return Err(ServiceIssue::unknown("豆包输入法识别 JSON 超过大小限制"));
        }
        Ok(response)
    }
}

#[derive(Deserialize)]
struct ResultBody {
    #[serde(default)]
    results: Option<Vec<Segment>>,
}

#[derive(Deserialize)]
struct Segment {
    index: Option<u32>,
    #[serde(default, deserialize_with = "text_or_empty")]
    text: String,
    is_interim: Option<bool>,
    is_vad_finished: Option<bool>,
    extra: Option<ResultFlags>,
}

#[derive(Deserialize)]
struct ResultFlags {
    #[serde(default)]
    nonstream_result: bool,
}

fn text_or_empty<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

impl Segment {
    fn is_final(&self) -> bool {
        self.extra
            .as_ref()
            .is_some_and(|extra| extra.nonstream_result)
            || (self.is_interim == Some(false) && self.is_vad_finished == Some(true))
    }
}

#[derive(Default)]
pub(super) struct Transcript {
    segments: BTreeMap<u32, Segment>,
    text_bytes: usize,
}

impl Transcript {
    /// Current SDK messages may be whole-transcript snapshots without an index.
    /// Indexed segments are merged only by their own identity and final flags.
    pub fn apply(&mut self, response: &Response) -> Result<Option<Cow<'_, str>>, ServiceIssue> {
        if response.result_json.is_empty() {
            return Ok(None);
        }
        let body: ResultBody = serde_json::from_str(&response.result_json)
            .map_err(|_| ServiceIssue::unknown("豆包输入法识别结果结构无效"))?;
        let results = body.results.unwrap_or_default();
        if results.len() > MAX_SEGMENTS as usize {
            return Err(ServiceIssue::unknown("豆包输入法识别结果超过数量限制"));
        }
        if results.iter().all(|segment| segment.index.is_none()) {
            // Indexless results are ordered whole-text hypotheses from multiple
            // passes, not separate utterances to concatenate. Only the selected
            // hypothesis's own flags can confirm its text.
            let Some(segment) = results
                .into_iter()
                .rev()
                .find(|segment| !segment.text.is_empty() || segment.is_final())
            else {
                return Ok(None);
            };
            if segment.text.len() > MAX_TEXT_BYTES {
                return Err(ServiceIssue::unknown("豆包输入法识别文本超过大小限制"));
            }
            let changed = self.segments.len() != 1
                || self
                    .segments
                    .get(&0)
                    .is_none_or(|previous| previous.text != segment.text);
            self.text_bytes = segment.text.len();
            self.segments.clear();
            self.segments.insert(0, segment);
            return Ok(changed.then(|| Cow::Borrowed(self.segments[&0].text.as_str())));
        }
        let mut changed = false;
        for segment in results {
            if segment.index.is_none() && segment.text.is_empty() && !segment.is_final() {
                continue;
            }
            let index = segment.index.ok_or_else(|| {
                ServiceIssue::unknown("识别结果混用了全文候选和分段标识，无法安全合并")
            })?;
            if index >= MAX_SEGMENTS {
                return Err(ServiceIssue::unknown("豆包输入法识别分段超过限制"));
            }
            let previous = self.segments.get(&index);
            if segment.text.is_empty() && !segment.is_final() && previous.is_none() {
                continue;
            }
            let next_bytes =
                self.text_bytes - previous.map_or(0, |value| value.text.len()) + segment.text.len();
            if next_bytes > MAX_TEXT_BYTES {
                return Err(ServiceIssue::unknown("豆包输入法识别文本超过大小限制"));
            }
            changed |= previous.is_none_or(|value| value.text != segment.text);
            self.text_bytes = next_bytes;
            self.segments.insert(index, segment);
        }
        Ok(changed.then(|| Cow::Owned(self.text())))
    }

    fn text(&self) -> String {
        let mut text = String::with_capacity(self.text_bytes);
        for segment in self.segments.values() {
            text.push_str(&segment.text);
        }
        text
    }

    pub fn finish(self) -> Result<String, ServiceIssue> {
        for (expected, (index, segment)) in self.segments.iter().enumerate() {
            if *index as usize != expected || !segment.is_final() {
                return Err(ServiceIssue::unknown(
                    "豆包输入法结束时仍有缺失或未确认的识别分段；没有使用临时结果",
                ));
            }
        }
        if self.segments.len() == 1 {
            return Ok(self.segments.into_values().next().unwrap().text);
        }
        Ok(self.text())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(json: &str) -> Response {
        Response {
            status: 20_000_000,
            result_json: json.to_owned(),
            ..Response::default()
        }
    }

    #[test]
    fn nullable_heartbeats_and_indexless_snapshots_keep_final_text() {
        let mut transcript = Transcript::default();
        assert!(
            transcript
                .apply(&response(r#"{"results":null}"#))
                .unwrap()
                .is_none()
        );
        assert!(
            transcript
                .apply(&response(
                    r#"{"results":[{"text":null,"is_interim":true}]}"#
                ))
                .unwrap()
                .is_none()
        );
        transcript.apply(&response(r#"{"results":[{"index":0,"text":"前句。","is_interim":false,"is_vad_finished":true},{"index":1,"text":"未完成","is_interim":true}]}"#)).unwrap();
        transcript.apply(&response(r#"{"results":[{"text":"较早候选","is_interim":true},{"text":"前句。最终修正。","extra":{"nonstream_result":true}}]}"#)).unwrap();
        assert_eq!(transcript.finish().unwrap(), "前句。最终修正。");
        let mut pending = Transcript::default();
        pending.apply(&response(r#"{"results":[{"text":"旧候选","is_interim":false,"is_vad_finished":true},{"text":"新候选尚未确认","is_interim":true}]}"#)).unwrap();
        assert!(pending.finish().is_err());
        assert!(
            Transcript::default()
                .apply(&response(
                    r#"{"results":[{"index":0,"text":"甲"},{"text":"乙"}]}"#
                ))
                .is_err()
        );
    }

    #[test]
    fn backend_failure_does_not_expire_an_account_or_accept_foreign_errors() {
        let mut failed = Response {
            request_id: "current".to_owned(),
            service_name: "ASR".to_owned(),
            event: "SessionFailed".to_owned(),
            status: 50_700_000,
            ..Response::default()
        };
        assert_eq!(
            Response::parse(&failed.encode_to_vec(), "current", true)
                .unwrap_err()
                .kind,
            "server"
        );
        failed.status = 401;
        assert_eq!(
            Response::parse(&failed.encode_to_vec(), "current", true)
                .unwrap_err()
                .kind,
            "loginRequired"
        );
        failed.request_id = "different-task".to_owned();
        assert_eq!(
            Response::parse(&failed.encode_to_vec(), "current", true)
                .unwrap_err()
                .kind,
            "unknown"
        );
    }

    #[test]
    fn final_flags_never_cross_result_boundaries() {
        let mut transcript = Transcript::default();
        transcript
            .apply(&response(
                r#"{"results":[
            {"index":0,"text":"已确认。","is_interim":false,"is_vad_finished":true},
            {"index":1,"text":"仍在识别","is_interim":true,"is_vad_finished":false}
        ]}"#,
            ))
            .unwrap();
        assert!(transcript.finish().is_err());

        let mut split_flags = Transcript::default();
        split_flags
            .apply(&response(
                r#"{"results":[
            {"index":0,"text":"甲","is_interim":false,"is_vad_finished":false},
            {"index":1,"text":"乙","is_interim":true,"is_vad_finished":true}
        ]}"#,
            ))
            .unwrap();
        assert!(split_flags.finish().is_err());
    }

    #[test]
    fn finish_event_keeps_all_segments_and_applies_last_correction() {
        let mut transcript = Transcript::default();
        transcript
            .apply(&response(
                r#"{"results":[
            {"index":0,"text":"第一句。","is_interim":false,"is_vad_finished":true},
            {"index":1,"text":"第二","is_interim":true}
        ]}"#,
            ))
            .unwrap();
        let mut finished = response(
            r#"{"results":[
            {"index":1,"text":"第二句。","is_interim":false,"is_vad_finished":true}
        ]}"#,
        );
        finished.event = "SessionFinished".to_owned();
        transcript.apply(&finished).unwrap();
        assert_eq!(transcript.finish().unwrap(), "第一句。第二句。");
    }

    #[test]
    fn unknown_event_failure_cannot_be_success() {
        let failed = Response {
            event: "NewEvent".to_owned(),
            status: 403,
            ..Response::default()
        };
        assert!(Response::parse(&failed.encode_to_vec(), "request", false).is_err());
        assert!(Response::parse(&[0x3a, 0x80], "request", false).is_err());
    }

    #[test]
    fn partial_downgrade_and_missing_segment_cannot_be_committed() {
        let mut transcript = Transcript::default();
        transcript
            .apply(&response(
                r#"{"results":[
            {"index":0,"text":"暂定","is_interim":false,"is_vad_finished":true}
        ]}"#,
            ))
            .unwrap();
        transcript
            .apply(&response(
                r#"{"results":[
            {"index":0,"text":"修正中","is_interim":true,"is_vad_finished":false}
        ]}"#,
            ))
            .unwrap();
        assert!(transcript.finish().is_err());
        let mut missing = Transcript::default();
        missing
            .apply(&response(
                r#"{"results":[
            {"index":1,"text":"遗漏首段","is_interim":false,"is_vad_finished":true}
        ]}"#,
            ))
            .unwrap();
        assert!(missing.finish().is_err());
    }
}
