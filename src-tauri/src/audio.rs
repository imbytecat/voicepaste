use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use cpal::{
    Device, FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig,
    traits::{DeviceTrait, HostTrait, StreamTrait},
};
use rtrb::{Consumer, Producer, RingBuffer};
use rubato::{Fft, FixedSync, Indexing, Resampler, audioadapter_buffers::direct::InterleavedSlice};
use serde::Serialize;

const OUTPUT_SAMPLE_RATE: usize = 16_000;
const CHUNKS_PER_SECOND: usize = 5;
const RING_SECONDS: usize = 2;

pub(crate) type AudioSink = dyn Fn(Vec<u8>) -> Result<(), String> + Send + Sync;
type LevelSink = dyn Fn(f32) + Send + Sync;
type ErrorSink = dyn Fn(String) + Send + Sync;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneDevice {
    id: String,
    label: String,
}

pub struct AudioCapture {
    stream: Option<Stream>,
    worker: Option<JoinHandle<()>>,
    stop: Arc<AtomicBool>,
}

impl AudioCapture {
    pub fn start(
        device_id: &str,
        on_audio: Option<Arc<AudioSink>>,
        on_level: Arc<LevelSink>,
        on_error: Arc<ErrorSink>,
    ) -> Result<Self, String> {
        let device = input_device(device_id)?;
        let supported = device
            .default_input_config()
            .map_err(|error| format!("读取麦克风格式失败：{error}"))?;
        let sample_rate = supported.sample_rate() as usize;
        let channels = supported.channels() as usize;
        if channels == 0 || sample_rate == 0 {
            return Err("麦克风返回了无效的音频格式".to_owned());
        }
        let converter = Converter::new(sample_rate)?;

        let (producer, consumer) = RingBuffer::new(sample_rate * RING_SECONDS);
        let stop = Arc::new(AtomicBool::new(false));
        let overflowed = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let worker_overflowed = Arc::clone(&overflowed);
        let worker_error = Arc::clone(&on_error);
        let worker = thread::Builder::new()
            .name("voicepaste-audio".to_owned())
            .spawn(move || {
                run_worker(
                    consumer,
                    converter,
                    worker_stop,
                    worker_overflowed,
                    on_audio,
                    on_level,
                    worker_error,
                )
            })
            .map_err(|error| format!("启动音频处理线程失败：{error}"))?;
        let worker_thread = worker.thread().clone();

        let config = supported.config();
        let sample_format = supported.sample_format();
        let stream_result = build_stream_for_format(
            &device,
            config,
            sample_format,
            channels,
            producer,
            worker_thread.clone(),
            Arc::clone(&overflowed),
            on_error,
        );
        let stream = match stream_result {
            Ok(stream) => stream,
            Err(error) => {
                stop.store(true, Ordering::Release);
                worker_thread.unpark();
                let _ = worker.join();
                return Err(error);
            }
        };
        if let Err(error) = stream.play() {
            drop(stream);
            stop.store(true, Ordering::Release);
            worker_thread.unpark();
            let _ = worker.join();
            return Err(format!("启动麦克风失败：{error}"));
        }

        Ok(Self {
            stream: Some(stream),
            worker: Some(worker),
            stop,
        })
    }

    fn shutdown(&mut self) {
        drop(self.stream.take());
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            worker.thread().unpark();
            let _ = worker.join();
        }
    }
}

impl Drop for AudioCapture {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn microphones() -> Result<Vec<MicrophoneDevice>, String> {
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|error| format!("读取麦克风列表失败：{error}"))?;
    let mut microphones = Vec::new();
    for device in devices {
        let id = device
            .id()
            .map_err(|error| format!("读取麦克风标识失败：{error}"))?
            .to_string();
        let label = device
            .description()
            .map(|description| description.name().to_owned())
            .unwrap_or_else(|_| device.to_string());
        microphones.push(MicrophoneDevice { id, label });
    }
    Ok(microphones)
}

fn input_device(device_id: &str) -> Result<Device, String> {
    if device_id.is_empty() {
        return cpal::default_host()
            .default_input_device()
            .ok_or_else(|| "系统没有可用的麦克风".to_owned());
    }

    let id = device_id
        .parse::<cpal::DeviceId>()
        .map_err(|error| format!("麦克风标识无效：{error}"))?;
    cpal::host_from_id(id.host())
        .map_err(|error| format!("麦克风后端不可用：{error}"))?
        .device_by_id(&id)
        .ok_or_else(|| "找不到所选麦克风，请在设置中重新选择".to_owned())
}

#[allow(clippy::too_many_arguments)]
fn build_stream_for_format(
    device: &Device,
    config: StreamConfig,
    sample_format: SampleFormat,
    channels: usize,
    producer: Producer<f32>,
    worker_thread: thread::Thread,
    overflowed: Arc<AtomicBool>,
    on_error: Arc<ErrorSink>,
) -> Result<Stream, String> {
    macro_rules! build {
        ($sample:ty) => {
            build_input_stream::<$sample>(
                device,
                config,
                channels,
                producer,
                worker_thread,
                overflowed,
                on_error,
            )
        };
    }

    match sample_format {
        SampleFormat::I8 => build!(i8),
        SampleFormat::I16 => build!(i16),
        SampleFormat::I32 => build!(i32),
        SampleFormat::I64 => build!(i64),
        SampleFormat::U8 => build!(u8),
        SampleFormat::U16 => build!(u16),
        SampleFormat::U32 => build!(u32),
        SampleFormat::U64 => build!(u64),
        SampleFormat::F32 => build!(f32),
        SampleFormat::F64 => build!(f64),
        format => Err(format!("麦克风使用了暂不支持的样本格式：{format}")),
    }
}

#[allow(clippy::too_many_arguments)]
fn build_input_stream<T>(
    device: &Device,
    config: StreamConfig,
    channels: usize,
    mut producer: Producer<f32>,
    worker_thread: thread::Thread,
    overflowed: Arc<AtomicBool>,
    on_error: Arc<ErrorSink>,
) -> Result<Stream, String>
where
    T: Sample + SizedSample,
    f32: FromSample<T>,
{
    let stream_error = Arc::clone(&on_error);
    device
        .build_input_stream::<T, _, _>(
            config,
            move |input, _| {
                for frame in input.chunks_exact(channels) {
                    let mut mono = 0.0;
                    for sample in frame {
                        mono += f32::from_sample(*sample);
                    }
                    if producer.push(mono / channels as f32).is_err() {
                        overflowed.store(true, Ordering::Release);
                        break;
                    }
                }
                worker_thread.unpark();
            },
            move |error| stream_error(format!("麦克风流中断：{error}")),
            None,
        )
        .map_err(|error| format!("打开麦克风失败：{error}"))
}

enum Converter {
    Direct {
        input_frames: usize,
    },
    Resampled {
        resampler: Box<Fft<f32>>,
        output: Vec<f32>,
    },
}

impl Converter {
    fn new(input_sample_rate: usize) -> Result<Self, String> {
        let input_frames = (input_sample_rate / CHUNKS_PER_SECOND).max(1);
        if input_sample_rate == OUTPUT_SAMPLE_RATE {
            return Ok(Self::Direct { input_frames });
        }
        let resampler = Box::new(
            Fft::<f32>::new(
                input_sample_rate,
                OUTPUT_SAMPLE_RATE,
                input_frames,
                1,
                FixedSync::Input,
            )
            .map_err(|error| format!("初始化音频重采样失败：{error}"))?,
        );
        let output = vec![0.0; resampler.output_frames_max()];
        Ok(Self::Resampled { resampler, output })
    }

    fn input_frames(&self) -> usize {
        match self {
            Self::Direct { input_frames } => *input_frames,
            Self::Resampled { resampler, .. } => resampler.input_frames_next(),
        }
    }

    fn is_resampled(&self) -> bool {
        matches!(self, Self::Resampled { .. })
    }

    fn process<'a>(
        &'a mut self,
        input: &'a [f32],
        valid_frames: usize,
    ) -> Result<&'a [f32], String> {
        match self {
            Self::Direct { .. } => Ok(&input[..valid_frames]),
            Self::Resampled { resampler, output } => {
                let output_capacity = output.len();
                let input_adapter = InterleavedSlice::new(input, 1, input.len())
                    .map_err(|error| format!("读取音频缓冲区失败：{error}"))?;
                let mut output_adapter = InterleavedSlice::new_mut(output, 1, output_capacity)
                    .map_err(|error| format!("写入音频缓冲区失败：{error}"))?;
                let indexing =
                    (valid_frames < input.len()).then(|| Indexing::new().partial_len(valid_frames));
                let (_, written) = resampler
                    .process_into_buffer(&input_adapter, &mut output_adapter, indexing.as_ref())
                    .map_err(|error| format!("音频重采样失败：{error}"))?;
                Ok(&output[..written])
            }
        }
    }
}

fn run_worker(
    mut consumer: Consumer<f32>,
    mut converter: Converter,
    stop: Arc<AtomicBool>,
    overflowed: Arc<AtomicBool>,
    on_audio: Option<Arc<AudioSink>>,
    on_level: Arc<LevelSink>,
    on_error: Arc<ErrorSink>,
) {
    let mut input = vec![0.0; converter.input_frames()];

    loop {
        if overflowed.swap(false, Ordering::AcqRel) {
            on_error("音频处理跟不上录音速度，请检查系统负载后重试".to_owned());
            return;
        }
        if consumer.slots() >= input.len() {
            let (_, remaining) = consumer.pop_partial_slice(&mut input);
            debug_assert!(remaining.is_empty());
            if let Err(error) =
                process_chunk(&mut converter, &input, input.len(), &on_audio, &on_level)
            {
                on_error(error);
                return;
            }
            continue;
        }
        if stop.load(Ordering::Acquire) {
            input.fill(0.0);
            let (samples, _) = consumer.pop_partial_slice(&mut input);
            let valid_frames = samples.len();
            if valid_frames > 0
                && let Err(error) =
                    process_chunk(&mut converter, &input, valid_frames, &on_audio, &on_level)
            {
                on_error(error);
                return;
            }
            if converter.is_resampled() {
                input.fill(0.0);
                if let Err(error) = process_chunk(&mut converter, &input, 0, &on_audio, &on_level) {
                    on_error(error);
                }
            }
            return;
        }
        thread::park_timeout(Duration::from_millis(20));
    }
}

fn process_chunk(
    converter: &mut Converter,
    input: &[f32],
    valid_frames: usize,
    on_audio: &Option<Arc<AudioSink>>,
    on_level: &Arc<LevelSink>,
) -> Result<(), String> {
    let output = converter.process(input, valid_frames)?;
    on_level(signal_level(output));
    if let Some(on_audio) = on_audio {
        on_audio(pcm_s16le(output))?;
    }
    Ok(())
}

fn signal_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let energy = samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32;
    (energy.sqrt() * 5.0).min(1.0)
}

fn pcm_s16le(samples: &[f32]) -> Vec<u8> {
    let mut pcm = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        pcm.extend_from_slice(&value.to_le_bytes());
    }
    pcm
}

#[cfg(test)]
mod tests {

    use super::{Converter, pcm_s16le, signal_level};

    #[test]
    fn uses_documented_200ms_audio_packets() {
        assert_eq!(Converter::new(16_000).unwrap().input_frames(), 3_200);
    }

    #[test]
    fn encodes_clamped_little_endian_pcm() {
        assert_eq!(
            pcm_s16le(&[-2.0, -1.0, 0.0, 1.0, 2.0]),
            [1, 128, 1, 128, 0, 0, 255, 127, 255, 127]
        );
    }

    #[test]
    fn level_is_bounded() {
        assert_eq!(signal_level(&[]), 0.0);
        assert!((signal_level(&[0.1, -0.1]) - 0.5).abs() < f32::EPSILON);
        assert_eq!(signal_level(&[1.0]), 1.0);
    }
}
