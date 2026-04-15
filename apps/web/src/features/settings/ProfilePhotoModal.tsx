import { useState, useRef, useCallback, useEffect } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { uploadProfilePhoto, deleteProfilePhoto } from '../../lib/api.ts'
import { CloseIcon, BackIcon } from '../../icons/index.tsx'
import { Pencil, Minus, Plus, RotateCw } from 'lucide-react'

type Step = 'pick' | 'adjust' | 'uploading' | 'success'

type ProfilePhotoModalProps = {
  initial: string
  hasExistingPhoto: boolean
  onClose: () => void
  onPhotoUpdated: (photoUrl: string | null) => void
  title?: string
  hint?: string
  adjustTitle?: string
  successTitle?: string
  successText?: string
  uploadingTitle?: string
  uploadButtonLabel?: string
  saveButtonLabel?: string
  removeButtonLabel?: string
  onUploadPhoto?: (photoBase64: string, contentType: string) => Promise<string | null | void>
  onDeletePhoto?: (() => Promise<void>) | null
}

export function ProfilePhotoModal({
  initial,
  hasExistingPhoto,
  onClose,
  onPhotoUpdated,
  title = 'Profile Photo',
  hint = 'A photo helps people recognise you',
  adjustTitle = 'Adjust Photo',
  successTitle = 'Photo Updated!',
  successText = 'Your profile photo has been updated successfully.',
  uploadingTitle = 'Uploading...',
  uploadButtonLabel = 'Upload Photo',
  saveButtonLabel = 'Save Photo',
  removeButtonLabel = 'Remove Photo',
  onUploadPhoto,
  onDeletePhoto = null,
}: ProfilePhotoModalProps) {
  const { sessionToken } = useAppContext()
  const sessionTokenRef = useRef(sessionToken)
  sessionTokenRef.current = sessionToken

  const [step, setStep] = useState<Step>('pick')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Crop state
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const handleFileSelect = useCallback((file: File) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowed.includes(file.type)) {
      setError('Please select a JPG, PNG, GIF or WebP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be smaller than 5 MB.')
      return
    }
    setError(null)
    setSelectedFile(file)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)

    // Load image for crop editor
    const img = new Image()
    img.onload = () => {
      imageRef.current = img
      setZoom(1)
      setRotation(0)
      setPanX(0)
      setPanY(0)
      setStep('adjust')
    }
    img.src = url
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  // Render crop preview
  useEffect(() => {
    if (step !== 'adjust' || !imageRef.current || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = 280
    canvas.width = size
    canvas.height = size

    ctx.clearRect(0, 0, size, size)
    ctx.save()

    // Clip to circle
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    ctx.clip()

    // Black background
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size, size)

    const img = imageRef.current
    const scale = Math.max(size / img.width, size / img.height) * zoom

    ctx.translate(size / 2 + panX, size / 2 + panY)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.drawImage(img, -img.width * scale / 2, -img.height * scale / 2, img.width * scale, img.height * scale)
    ctx.restore()
  }, [step, zoom, rotation, panX, panY])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true)
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX, panY }
  }, [panX, panY])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    setPanX(dragStartRef.current.panX + dx)
    setPanY(dragStartRef.current.panY + dy)
  }, [dragging])

  const handleMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  const generateCroppedBlob = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = imageRef.current
      if (!img) return reject(new Error('No image'))

      const outputSize = 512
      const offscreen = document.createElement('canvas')
      offscreen.width = outputSize
      offscreen.height = outputSize
      const ctx = offscreen.getContext('2d')
      if (!ctx) return reject(new Error('No context'))

      ctx.beginPath()
      ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2)
      ctx.clip()

      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, outputSize, outputSize)

      const previewSize = 280
      const scaleFactor = outputSize / previewSize
      const scale = Math.max(previewSize / img.width, previewSize / img.height) * zoom

      ctx.translate(outputSize / 2 + panX * scaleFactor, outputSize / 2 + panY * scaleFactor)
      ctx.rotate((rotation * Math.PI) / 180)
      const finalScale = scale * scaleFactor
      ctx.drawImage(img, -img.width * finalScale / 2, -img.height * finalScale / 2, img.width * finalScale, img.height * finalScale)

      offscreen.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to create blob'))
      }, 'image/jpeg', 0.9)
    })
  }, [zoom, rotation, panX, panY])

  const handleSaveAndUpload = useCallback(async () => {
    const token = sessionTokenRef.current
    if (!token) return

    setStep('uploading')
    setUploadProgress(0)
    setError(null)

    try {
      const blob = await generateCroppedBlob()

      const buffer = await blob.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )

      const progressTimer = setInterval(() => {
        setUploadProgress((p) => Math.min(p + 15, 90))
      }, 200)

      const uploadedUrl =
        onUploadPhoto
          ? await onUploadPhoto(base64, 'image/jpeg')
          : (await uploadProfilePhoto(token, base64, 'image/jpeg')).photo_url

      clearInterval(progressTimer)
      setUploadProgress(100)

      setTimeout(() => {
        setStep('success')
        onPhotoUpdated(uploadedUrl ?? null)
      }, 300)
    } catch (err) {
      setStep('adjust')
      setError(err instanceof Error ? err.message : 'Upload failed.')
    }
  }, [generateCroppedBlob, onPhotoUpdated, onUploadPhoto])

  const handleRemove = useCallback(async () => {
    try {
      if (onDeletePhoto) {
        await onDeletePhoto()
      } else {
        const token = sessionTokenRef.current
        if (!token) return
        await deleteProfilePhoto(token)
      }
      onPhotoUpdated(null)
      onClose()
    } catch {
      setError('Failed to remove photo.')
    }
  }, [onDeletePhoto, onPhotoUpdated, onClose])

  return (
    <div className="incoming-call-overlay" onClick={onClose}>
      <div className="profile-photo-modal" onClick={(e) => e.stopPropagation()}>

        {/* ── Step 1: Pick ─────────────────────────────────────── */}
        {step === 'pick' && (
          <>
            <div className="profile-photo-modal__header">
              <span className="profile-photo-modal__title">{title}</span>
              <button type="button" className="profile-photo-modal__close" onClick={onClose}>
                <CloseIcon width={18} height={18} />
              </button>
            </div>
            <div className="profile-photo-modal__body">
              <div className="profile-photo-modal__avatar-wrap">
                {previewUrl ? (
                  <img src={previewUrl} alt="Preview" className="profile-photo-modal__avatar-img" />
                ) : (
                  <div className="profile-photo-modal__avatar-placeholder">{initial}</div>
                )}
                <span className="profile-photo-modal__camera-badge">
                  <Pencil size={12} />
                </span>
              </div>
              <span className="profile-photo-modal__hint">{hint}</span>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                hidden
                onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]) }}
              />

              <div
                className="profile-photo-modal__dropzone"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                <span>Drag & drop or click to browse</span>
                <span className="profile-photo-modal__dropzone-hint">JPG, PNG or GIF · Max 5 MB</span>
              </div>

              {error && <span className="profile-photo-modal__error">{error}</span>}
            </div>
            <div className="profile-photo-modal__footer">
              {hasExistingPhoto && (onDeletePhoto !== null || !onUploadPhoto) && (
                <button type="button" className="profile-photo-modal__btn profile-photo-modal__btn--outline" onClick={() => void handleRemove()}>
                  {removeButtonLabel}
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="profile-photo-modal__btn profile-photo-modal__btn--primary"
                disabled={!selectedFile}
                onClick={() => setStep('adjust')}
              >
                {uploadButtonLabel}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Adjust (Crop/Zoom/Rotate) ───────────────── */}
        {step === 'adjust' && (
          <>
            <div className="profile-photo-modal__header">
              <button type="button" className="profile-photo-modal__close" onClick={() => setStep('pick')} style={{ marginRight: 8 }}>
                <BackIcon width={18} height={18} />
              </button>
              <span className="profile-photo-modal__title" style={{ flex: 1 }}>{adjustTitle}</span>
              <button type="button" className="profile-photo-modal__close" onClick={onClose}>
                <CloseIcon width={18} height={18} />
              </button>
            </div>
            <div className="profile-photo-modal__body" style={{ padding: '16px 20px', gap: 12 }}>
              {/* Rotate button */}
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                style={{ alignSelf: 'flex-start', background: 'var(--bg-surface-1)', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}
                aria-label="Rotate"
              >
                <RotateCw size={16} />
              </button>

              {/* Crop canvas */}
              <div
                style={{ position: 'relative', width: 280, height: 280, cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <canvas
                  ref={canvasRef}
                  width={280}
                  height={280}
                  style={{ width: 280, height: 280, borderRadius: '50%' }}
                />
                {/* Crosshair overlay */}
                <svg width="280" height="280" viewBox="0 0 280 280" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  <circle cx="140" cy="140" r="139" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                  <line x1="140" y1="0" x2="140" y2="280" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                  <line x1="0" y1="140" x2="280" y2="140" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                </svg>
              </div>

              {/* Zoom slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 4 }}>
                  <Minus size={16} />
                </button>
                <input
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent)' }}
                />
                <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 4 }}>
                  <Plus size={16} />
                </button>
              </div>

              {error && <span className="profile-photo-modal__error">{error}</span>}
            </div>
            <div className="profile-photo-modal__footer">
              <button type="button" className="profile-photo-modal__btn profile-photo-modal__btn--outline" onClick={() => { setStep('pick'); setSelectedFile(null); setPreviewUrl(null) }}>
                Cancel
              </button>
              <div style={{ flex: 1 }} />
              <button type="button" className="profile-photo-modal__btn profile-photo-modal__btn--primary" onClick={() => void handleSaveAndUpload()}>
                {saveButtonLabel}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Uploading ───────────────────────────────── */}
        {step === 'uploading' && (
          <>
            <div className="profile-photo-modal__header">
              <span className="profile-photo-modal__title">{uploadingTitle}</span>
              <button type="button" className="profile-photo-modal__close" onClick={onClose}>
                <CloseIcon width={18} height={18} />
              </button>
            </div>
            <div className="profile-photo-modal__body" style={{ alignItems: 'center' }}>
              <div className="profile-photo-modal__progress-ring">
                <svg width="100" height="100" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--bg-surface-2)" strokeWidth="6" />
                  <circle
                    cx="50" cy="50" r="42" fill="none"
                    stroke="var(--accent)" strokeWidth="6"
                    strokeDasharray={2 * Math.PI * 42}
                    strokeDashoffset={2 * Math.PI * 42 * (1 - uploadProgress / 100)}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                    style={{ transition: 'stroke-dashoffset 200ms linear' }}
                  />
                </svg>
                <span className="profile-photo-modal__progress-text">{uploadProgress}%</span>
              </div>
              <span className="profile-photo-modal__filename">{selectedFile?.name ?? 'profile-photo.jpg'}</span>
              <span className="profile-photo-modal__upload-size">
                Uploading · {Math.round((selectedFile?.size ?? 0) * uploadProgress / 100 / 1024)} KB of {Math.round((selectedFile?.size ?? 0) / 1024)} KB
              </span>
              <div className="profile-photo-modal__progress-bar">
                <div className="profile-photo-modal__progress-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
            <div className="profile-photo-modal__footer" style={{ justifyContent: 'center' }}>
              <button type="button" className="profile-photo-modal__btn profile-photo-modal__btn--outline" onClick={onClose}>
                Cancel Upload
              </button>
            </div>
          </>
        )}

        {/* ── Step 4: Success ─────────────────────────────────── */}
        {step === 'success' && (
          <>
            <div className="profile-photo-modal__header">
              <span className="profile-photo-modal__title">{title}</span>
              <button type="button" className="profile-photo-modal__close" onClick={onClose}>
                <CloseIcon width={18} height={18} />
              </button>
            </div>
            <div className="profile-photo-modal__body" style={{ alignItems: 'center' }}>
              <div className="profile-photo-modal__success-avatar">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span className="profile-photo-modal__success-badge">✓</span>
              </div>
              <span className="profile-photo-modal__success-title">{successTitle}</span>
              <span className="profile-photo-modal__success-text">{successText}</span>
            </div>
            <div className="profile-photo-modal__footer" style={{ justifyContent: 'center' }}>
              <button type="button" className="profile-photo-modal__btn profile-photo-modal__btn--primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
