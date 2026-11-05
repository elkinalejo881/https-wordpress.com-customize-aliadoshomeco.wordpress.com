const PDF = ['application/pdf'];
const IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/tiff'];
const DICOM = ['application/dicom'];

/**
 * Catálogo de tipos. maxMb y retentionYears son VALORES POR DEFECTO, configurables con
 * DOC_LIMITS_MB='{"radiograph":120}' y DOC_RETENTION_YEARS='{"clinical_history_pdf":20}'.
 * Los años de retención son un supuesto técnico: confirmar con asesoría legal/normativa vigente.
 */
export const KINDS = {
  lab_result_pdf:       { mimes: PDF,                    maxMb: 20, retentionYears: 10, ownerVisible: true,  image: false },
  clinical_history_pdf: { mimes: PDF,                    maxMb: 30, retentionYears: 10, ownerVisible: false, image: false },
  patient_photo:        { mimes: IMG,                    maxMb: 15, retentionYears: 5,  ownerVisible: true,  image: true },
  sample_photo:         { mimes: IMG,                    maxMb: 15, retentionYears: 5,  ownerVisible: false, image: true },
  diagnostic_image:     { mimes: [...IMG, ...DICOM],     maxMb: 60, retentionYears: 10, ownerVisible: true,  image: true },
  radiograph:           { mimes: [...IMG, ...DICOM],     maxMb: 100, retentionYears: 10, ownerVisible: true, image: true },
  ultrasound:           { mimes: [...IMG, ...DICOM, ...PDF], maxMb: 100, retentionYears: 10, ownerVisible: true, image: true },
  attachment:           { mimes: [...PDF, ...IMG],       maxMb: 20, retentionYears: 5,  ownerVisible: false, image: true },
  generated_report:     { mimes: PDF,                    maxMb: 30, retentionYears: 10, ownerVisible: true,  image: false },
};
export const KIND_NAMES = Object.keys(KINDS);

export function kindPolicy(kind, cfg) {
  const k = KINDS[kind]; if (!k) return null;
  return { ...k, maxBytes: Math.round((cfg.limitsMb?.[kind] ?? k.maxMb) * 1048576), retentionYears: cfg.retentionYears?.[kind] ?? k.retentionYears };
}
