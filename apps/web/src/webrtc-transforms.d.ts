type EncodedFrame = RTCEncodedAudioFrame | RTCEncodedVideoFrame

interface RTCRtpScriptTransformOptions {
  operation?: 'encrypt' | 'decrypt'
  keyBase64?: string | null
  port?: MessagePort
}

interface RTCRtpScriptTransformer {
  readable: ReadableStream<EncodedFrame>
  writable: WritableStream<EncodedFrame>
  options?: RTCRtpScriptTransformOptions
}

interface RTCRtpTransformEvent extends Event {
  transformer: RTCRtpScriptTransformer
}

declare class RTCRtpScriptTransform {
  constructor(
    worker: Worker,
    options?: RTCRtpScriptTransformOptions,
    transfer?: Transferable[]
  )
}

interface RTCRtpSender {
  transform?: RTCRtpScriptTransform
}

interface RTCRtpReceiver {
  transform?: RTCRtpScriptTransform
}

interface DedicatedWorkerGlobalScopeEventMap {
  rtctransform: RTCRtpTransformEvent
}
